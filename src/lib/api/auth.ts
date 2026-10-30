import { NextRequest } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { buildSigningPayload, computeSignature, MASTER_AGENT, signaturesMatch, signingSecretFor } from "./signing";
import { ENV_AGENT_KEY_VARS, hasScope, isMintedKeyFormat, WILDCARD_SCOPE, type Scope } from "./agent-key-scopes";
import { scopedRouteAllowed } from "./scoped-routes";
import { verifyAgentKey } from "./agent-keys";

/**
 * Session roles. 'admin' is the default (any user without an explicit role in
 * app_metadata — older accounts predate roles). 'social' is the social media
 * manager: full run of /social, nothing else. API keys are unaffected.
 */
export type SessionRole = "admin" | "social";

export type AuthResult =
  | { authenticated: true; mode: "session"; userId: string; role: SessionRole }
  | {
      authenticated: true;
      mode: "api-key";
      agent: string;
      /** What this key may do. The master and env-var keys hold ["*"];
       *  a minted key (public.agent_keys) holds only what it was minted with. */
      scopes?: string[];
    }
  | { authenticated: false; error: string };

export interface AuthOptions {
  /** Session roles allowed on this route. Defaults to admin-only, so the
   *  social role has to be explicitly opted in by the /api/social routes. */
  allowRoles?: SessionRole[];
}

const DEFAULT_SIGNATURE_TTL_SECONDS = 300;

type ApiKeyResult = Extract<AuthResult, { mode: "api-key" } | { authenticated: false }>;

/** The master and env-var agent keys. Synchronous; no database. */
function validateEnvApiKey(key: string): ApiKeyResult {
  if (key === process.env.API_SECRET_KEY) {
    return { authenticated: true, mode: "api-key", agent: MASTER_AGENT, scopes: [WILDCARD_SCOPE] };
  }

  for (const [agent, envVar] of Object.entries(ENV_AGENT_KEY_VARS)) {
    const agentKey = process.env[envVar];
    if (agentKey && key === agentKey) {
      return { authenticated: true, mode: "api-key", agent, scopes: [WILDCARD_SCOPE] };
    }
  }

  return { authenticated: false, error: "Invalid API key" };
}

/**
 * Env keys first, then a minted key from public.agent_keys. `minted` tells
 * the signature check that the key signs with itself.
 */
async function validateApiKey(key: string): Promise<{ result: ApiKeyResult; minted: boolean }> {
  const envResult = validateEnvApiKey(key);
  if (envResult.authenticated || !isMintedKeyFormat(key)) {
    return { result: envResult, minted: false };
  }

  try {
    const minted = await verifyAgentKey(createAdminClient(), key);
    if (minted) {
      return {
        result: { authenticated: true, mode: "api-key", agent: minted.name, scopes: minted.scopes },
        minted: true,
      };
    }
  } catch {
    // A database hiccup is a failed key, never an open door.
  }
  return { result: envResult, minted: false };
}

function getSignatureTtlSeconds(): number {
  const raw = Number(process.env.API_REQUEST_SIGNATURE_TTL_SECONDS || DEFAULT_SIGNATURE_TTL_SECONDS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SIGNATURE_TTL_SECONDS;
}

async function validateApiSignature(request: NextRequest): Promise<AuthResult> {
  const apiKey = request.headers.get("x-api-key");
  if (!apiKey) {
    return { authenticated: false, error: "Missing x-api-key" };
  }

  const { result: keyValidation, minted } = await validateApiKey(apiKey);
  if (!keyValidation.authenticated) {
    return keyValidation;
  }

  const signatureRequired = (process.env.API_SIGNATURE_REQUIRED || "true").toLowerCase() !== "false";
  if (!signatureRequired && !minted) {
    return keyValidation;
  }

  const timestamp = request.headers.get("x-timestamp");
  const signature = request.headers.get("x-signature");

  if (!timestamp || !signature) {
    return {
      authenticated: false,
      error: "Missing x-timestamp or x-signature for machine request",
    };
  }

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) {
    return { authenticated: false, error: "Invalid x-timestamp" };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const maxAge = getSignatureTtlSeconds();
  if (Math.abs(nowSeconds - timestampSeconds) > maxAge) {
    return { authenticated: false, error: "Expired x-timestamp" };
  }

  // With API_PER_KEY_SIGNING on, a named agent key must have signed with its
  // own key; only the master key signs with the shared signing secret. Off
  // (the default), every env key signs with the shared secret as before. A
  // minted key always signs with itself.
  const signingSecret = signingSecretFor(keyValidation.agent, apiKey, process.env, { minted });
  if (!signingSecret) {
    return { authenticated: false, error: "API request signing secret is not configured" };
  }

  const bodyText = await request.clone().text();
  const pathname = new URL(request.url).pathname;
  const signingPayload = buildSigningPayload(request.method, pathname, timestamp, bodyText);
  const expectedSignature = computeSignature(signingSecret, signingPayload);

  if (!signaturesMatch(expectedSignature, signature)) {
    return { authenticated: false, error: "Invalid x-signature" };
  }

  return keyValidation;
}

async function validateSession(opts: AuthOptions = {}): Promise<AuthResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      return { authenticated: false, error: "Not authenticated" };
    }

    const role: SessionRole =
      (user.app_metadata as { role?: string } | null)?.role === "social" ? "social" : "admin";
    const allowed = opts.allowRoles || ["admin"];
    if (!allowed.includes(role)) {
      return { authenticated: false, error: "This account only has access to the social studio" };
    }

    return { authenticated: true, mode: "session", userId: user.id, role };
  } catch {
    return { authenticated: false, error: "Session validation failed" };
  }
}

export async function authenticateSession(
  _request: NextRequest,
  opts: AuthOptions = {}
): Promise<AuthResult> {
  void _request;
  return validateSession(opts);
}

export async function authenticateSessionOrApiKey(
  request: NextRequest,
  opts: AuthOptions = {}
): Promise<AuthResult> {
  const apiKey = request.headers.get("x-api-key");
  if (apiKey) {
    const auth = await validateApiSignature(request);
    if (auth.authenticated && auth.mode === "api-key" && !scopedRouteAllowed(request.method, new URL(request.url).pathname, auth.scopes ?? [])) {
      return { authenticated: false, error: "This key is not authorised for this route" };
    }
    return auth;
  }

  return validateSession(opts);
}

export function unauthorizedResponse(error: string = "Unauthorized") {
  return Response.json({ error }, { status: 401 });
}

/**
 * A 403 when an API key lacks `scope`, else null. Sessions pass (session
 * roles are checked by allowRoles); so do the master and env-var keys, which
 * hold "*". Call it right after the authenticated check:
 *
 *   const denied = requireScope(auth, "leads:read");
 *   if (denied) return denied;
 */
export function requireScope(auth: AuthResult, scope: Scope): Response | null {
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  if (auth.mode === "session") return null;
  // A result built elsewhere without scopes (lib/studio/auth.ts) is the master.
  const scopes = auth.scopes ?? (auth.agent === MASTER_AGENT ? [WILDCARD_SCOPE] : []);
  if (hasScope(scopes, scope)) return null;
  return Response.json({ error: `This key does not have the ${scope} scope`, scope }, { status: 403 });
}
