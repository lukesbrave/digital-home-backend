/**
 * Request signing for machine calls (x-api-key + x-timestamp + x-signature).
 *
 * Pure functions, no framework imports, so they can be unit-tested with
 * `node --test` and reused by clients that sign their own requests.
 *
 * Two modes, chosen by API_PER_KEY_SIGNING:
 *
 * - off (default, today's behaviour): every key signs with the one shared
 *   signing secret (API_REQUEST_SIGNING_SECRET, else API_SECRET_KEY). A named
 *   agent key therefore also holds the master signing secret.
 * - on: a named agent key signs with ITS OWN key value; only the master key
 *   signs with the shared signing secret. An agent then holds nothing but its
 *   own key, and revoking that key revokes everything it could do.
 *
 * Turn the flag on only after every named agent signs with its own key.
 *
 * A minted key (public.agent_keys, AGENT-KEYS.md) always signs with itself,
 * flag or no flag: it is new, so no client signs it the old way, and an agent
 * moved onto one never needs the shared secret.
 */

import { createHmac, timingSafeEqual } from "crypto";

export const MASTER_AGENT = "master";

type Env = Record<string, string | undefined>;

export function perKeySigningEnabled(env: Env = process.env): boolean {
  const raw = (env.API_PER_KEY_SIGNING || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on" || raw === "yes";
}

/** The shared signing secret the master key (and, with the flag off, everyone) uses. */
export function sharedSigningSecret(env: Env = process.env): string | undefined {
  return env.API_REQUEST_SIGNING_SECRET || env.API_SECRET_KEY || undefined;
}

/**
 * Which secret a validated key must have signed with. Returns undefined when
 * the deployment has no signing secret configured at all. `minted` is true
 * when the key was verified against public.agent_keys rather than the env.
 */
export function signingSecretFor(
  agent: string,
  apiKey: string,
  env: Env = process.env,
  opts: { minted?: boolean } = {}
): string | undefined {
  if (opts.minted) {
    return apiKey;
  }
  if (perKeySigningEnabled(env) && agent !== MASTER_AGENT) {
    return apiKey;
  }
  return sharedSigningSecret(env);
}

export function buildSigningPayload(method: string, pathname: string, timestamp: string, body: string): string {
  return [method.toUpperCase(), pathname, timestamp, body].join(":");
}

export function computeSignature(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function signaturesMatch(expected: string, actual: string): boolean {
  const normalizedActual = actual.replace(/^sha256=/, "").trim().toLowerCase();
  const normalizedExpected = expected.trim().toLowerCase();

  if (!normalizedActual || normalizedActual.length !== normalizedExpected.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(normalizedExpected, "utf8"), Buffer.from(normalizedActual, "utf8"));
}
