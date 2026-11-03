/** MCP accepts the master or a live scoped key; older env agent keys still require signed HTTP. */
import {
  ENV_AGENT_KEY_VARS,
  isMintedKeyFormat,
  WILDCARD_SCOPE,
} from "../api/agent-key-scopes.ts";
import type { McpCaller } from "./types.ts";

export type McpAuthResult =
  | { ok: true; caller: McpCaller }
  | { ok: false; error: string };

export type MintedKeyLookup = (
  token: string,
) => Promise<{ name: string; scopes: readonly string[] } | null>;

type Env = Record<string, string | undefined>;

/** Env-var keys a bearer may carry, agent name → variable. */
const BEARER_ENV_KEYS: Record<string, string> = { master: "API_SECRET_KEY" };

export async function resolveMcpCaller(
  token: string | null,
  env: Env,
  lookupMinted: MintedKeyLookup,
): Promise<McpAuthResult> {
  if (!token)
    return {
      ok: false,
      error: "Missing bearer token (Authorization: Bearer <key>)",
    };

  for (const [agent, variable] of Object.entries(BEARER_ENV_KEYS)) {
    const key = env[variable];
    if (key && token === key)
      return {
        ok: true,
        caller: { agent, scopes: [WILDCARD_SCOPE], kind: "env" },
      };
  }
  for (const variable of Object.values(ENV_AGENT_KEY_VARS)) {
    const key = env[variable];
    if (key && token === key) {
      return {
        ok: false,
        error:
          "This agent key must sign its requests; use a minted key (bbk_...) for MCP",
      };
    }
  }

  if (isMintedKeyFormat(token)) {
    try {
      const minted = await lookupMinted(token);
      if (minted)
        return {
          ok: true,
          caller: { agent: minted.name, scopes: minted.scopes, kind: "minted" },
        };
    } catch {
      // A database hiccup is a failed key, never an open door.
    }
  }
  return { ok: false, error: "Invalid or revoked key" };
}
