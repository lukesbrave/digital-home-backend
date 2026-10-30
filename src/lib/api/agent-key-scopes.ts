/**
 * Agent keys — the pure half: key format, hashing and scopes.
 *
 * No framework imports, so `node --test` can load it and clients can reuse
 * it. The database half (mint, verify, revoke, list) is ./agent-keys.ts.
 *
 * A minted key looks like `bbk_<name>_<32 hex>`. Only its sha256 is stored;
 * the plaintext is shown once at mint. A minted key always signs its own
 * requests with itself (see signingSecretFor in ./signing.ts).
 */

import { createHash, randomBytes } from "crypto";

export const KEY_PREFIX = "bbk_";

/** The scope vocabulary shared with GET /api/home and the starter. */
export const SCOPES = [
  "leads:read",
  "leads:write",
  "content:read",
  "content:write",
  "social:write",
  "brand:read",
  "brand:write",
  "approvals:propose",
  "settings:read",
  "events:read",
  "money:read",
  "money:write",
  "money:checkout",
] as const;

export type Scope = (typeof SCOPES)[number];

/** Held only by the master key and the env-var agent keys; never minted. */
export const WILDCARD_SCOPE = "*";

/**
 * The env-var agent keys, name → variable. They predate scopes, hold every
 * scope, and their names are reserved so a minted key can never pass for one
 * (routes allowlist `hermes` and `master` by name).
 */
export const ENV_AGENT_KEY_VARS: Record<string, string> = {
  content_agent: "CONTENT_AGENT_API_KEY",
  seo_agent: "SEO_AGENT_API_KEY",
  analytics_agent: "ANALYTICS_AGENT_API_KEY",
  email_agent: "EMAIL_AGENT_API_KEY",
  openclawd: "OPENCLAWD_API_KEY",
};

export const RESERVED_AGENT_NAMES = new Set(["master", ...Object.keys(ENV_AGENT_KEY_VARS)]);

const NAME_RE = /^[a-z][a-z0-9_-]{1,39}$/;
const KEY_RE = /^bbk_[a-z][a-z0-9_-]{1,39}_[0-9a-f]{32}$/;

/** How long a key's last_used_at may lag before a request refreshes it. */
export const LAST_USED_TOUCH_MS = 10 * 60_000;

export function hashKey(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

/** A fresh plaintext key for `name`. `random` is for tests only. */
export function newKeyPlaintext(name: string, random: string = randomBytes(16).toString("hex")): string {
  return `${KEY_PREFIX}${name}_${random}`;
}

/** What the owner sees in a list: the name plus the first four random characters. */
export function keyDisplayPrefix(plaintext: string): string {
  return plaintext.slice(0, plaintext.lastIndexOf("_") + 5);
}

/** True for strings shaped like a minted key; anything else skips the database. */
export function isMintedKeyFormat(key: string): boolean {
  return KEY_RE.test(key);
}

/** Returns an error message, or null when the name can be minted. */
export function validateKeyName(name: unknown): string | null {
  if (typeof name !== "string" || !NAME_RE.test(name)) {
    return "name must be 2–40 characters: lowercase letters, digits, _ or -, starting with a letter";
  }
  if (RESERVED_AGENT_NAMES.has(name)) {
    return `"${name}" is reserved for the master or an env-var agent key`;
  }
  return null;
}

export type ParsedScopes = { ok: true; scopes: Scope[] } | { ok: false; error: string };

/**
 * Accepts an array or a comma-separated string. Every scope must be in the
 * vocabulary; `*` is refused (a minted key is always scoped); at least one.
 */
export function parseScopes(input: unknown): ParsedScopes {
  const raw = Array.isArray(input) ? input : typeof input === "string" ? input.split(",") : null;
  if (!raw) return { ok: false, error: "scopes must be an array or a comma-separated string" };

  const scopes: Scope[] = [];
  for (const item of raw) {
    const scope = typeof item === "string" ? item.trim() : "";
    if (!scope) continue;
    if (scope === WILDCARD_SCOPE) return { ok: false, error: "a minted key cannot hold *; name its scopes" };
    if (!(SCOPES as readonly string[]).includes(scope)) {
      return { ok: false, error: `unknown scope "${scope}"; known: ${SCOPES.join(", ")}` };
    }
    if (!scopes.includes(scope as Scope)) scopes.push(scope as Scope);
  }
  if (scopes.length === 0) return { ok: false, error: "at least one scope is required" };
  return { ok: true, scopes };
}

/** Drops anything outside the vocabulary, `*` included, from scopes read back from the database. */
export function knownScopes(stored: readonly string[] | null | undefined): Scope[] {
  return (stored || []).filter((s): s is Scope => (SCOPES as readonly string[]).includes(s));
}

export function hasScope(scopes: readonly string[] | undefined, wanted: Scope): boolean {
  if (!scopes) return false;
  return scopes.includes(WILDCARD_SCOPE) || scopes.includes(wanted);
}

export function shouldTouchLastUsed(lastUsedAt: string | null, now: number = Date.now()): boolean {
  if (!lastUsedAt) return true;
  const last = Date.parse(lastUsedAt);
  return !Number.isFinite(last) || now - last >= LAST_USED_TOUCH_MS;
}
