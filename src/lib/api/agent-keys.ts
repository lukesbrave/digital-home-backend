/**
 * Agent keys — the database half: mint, verify, revoke and list rows in
 * public.agent_keys (see AGENT-KEYS.md and the 20261026120000 migration).
 *
 * Pass the service-role client (createAdminClient); the table has no other
 * grants. The plaintext leaves mintAgentKey once and is never stored or logged.
 */

import type { createAdminClient } from "@/lib/supabase/server";
import {
  hashKey,
  isMintedKeyFormat,
  keyDisplayPrefix,
  knownScopes,
  LAST_USED_TOUCH_MS,
  newKeyPlaintext,
  parseScopes,
  shouldTouchLastUsed,
  validateKeyName,
  type Scope,
} from "./agent-key-scopes.ts";

export { hashKey, hasScope, parseScopes, SCOPES, type Scope } from "./agent-key-scopes.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every column except key_hash. */
const LIST_COLUMNS = "id, name, key_prefix, scopes, created_at, created_by, last_used_at, revoked_at, note";

export interface AgentKeySummary {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  created_at: string;
  created_by: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  note: string | null;
}

export interface MintedAgentKey extends AgentKeySummary {
  /** Shown once. Not stored; cannot be recovered. */
  plaintext: string;
}

/** A refusal the owner routes turn into a status code. */
export class AgentKeyError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function mintAgentKey(
  supabase: AdminClient,
  input: { name: unknown; scopes: unknown; createdBy: string; note?: unknown }
): Promise<MintedAgentKey> {
  const nameError = validateKeyName(input.name);
  if (nameError) throw new AgentKeyError(nameError, 400);
  const name = input.name as string;
  const parsed = parseScopes(input.scopes);
  if (!parsed.ok) throw new AgentKeyError(parsed.error, 400);
  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim().slice(0, 500) : null;

  const plaintext = newKeyPlaintext(name);
  const { data, error } = await supabase
    .from("agent_keys")
    .insert({
      name,
      key_prefix: keyDisplayPrefix(plaintext),
      key_hash: hashKey(plaintext),
      scopes: parsed.scopes,
      created_by: input.createdBy,
      note,
    })
    .select(LIST_COLUMNS)
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new AgentKeyError(`"${name}" already has an active key; revoke it first or pick another name`, 409);
    }
    throw new AgentKeyError("Could not store the key (is the agent_keys migration applied?)", 503);
  }
  return { ...(data as AgentKeySummary), plaintext };
}

/**
 * The agent a presented key belongs to, or null for anything that is not a
 * live minted key. Refreshes last_used_at at most once per 10 minutes, and
 * never fails a request because that write failed.
 */
export async function verifyAgentKey(
  supabase: AdminClient,
  plaintext: string
): Promise<{ name: string; scopes: Scope[] } | null> {
  if (!isMintedKeyFormat(plaintext)) return null;

  const { data, error } = await supabase
    .from("agent_keys")
    .select("id, name, scopes, last_used_at, revoked_at")
    .eq("key_hash", hashKey(plaintext))
    .maybeSingle();
  if (error || !data || data.revoked_at) return null;

  if (shouldTouchLastUsed(data.last_used_at)) {
    const now = new Date();
    const cutoff = new Date(now.getTime() - LAST_USED_TOUCH_MS).toISOString();
    // Conditional, so concurrent requests from one agent write once.
    const { error: touchError } = await supabase
      .from("agent_keys")
      .update({ last_used_at: now.toISOString() })
      .eq("id", data.id)
      .or(`last_used_at.is.null,last_used_at.lt.${cutoff}`);
    if (touchError) console.error("agent key last_used_at not updated");
  }

  return { name: data.name, scopes: knownScopes(data.scopes) };
}

/** Revokes the active key with this id or name. Null when there is none. */
export async function revokeAgentKey(
  supabase: AdminClient,
  target: { id?: string; name?: string }
): Promise<AgentKeySummary | null> {
  if (!target.id && !target.name) throw new AgentKeyError("Pass ?id= or ?name=", 400);
  if (target.id && !UUID_RE.test(target.id)) throw new AgentKeyError("id is not a key id", 400);
  let query = supabase.from("agent_keys").update({ revoked_at: new Date().toISOString() }).is("revoked_at", null);
  query = target.id ? query.eq("id", target.id) : query.eq("name", target.name as string);
  const { data, error } = await query.select(LIST_COLUMNS);
  if (error) throw new AgentKeyError("Could not revoke the key", 503);
  return ((data || [])[0] as AgentKeySummary | undefined) ?? null;
}

/** Every key, newest first, revoked ones included. Never returns the hash. */
export async function listAgentKeys(supabase: AdminClient): Promise<AgentKeySummary[]> {
  const { data, error } = await supabase
    .from("agent_keys")
    .select(LIST_COLUMNS)
    .order("created_at", { ascending: false });
  if (error) throw new AgentKeyError("Could not read agent keys (is the agent_keys migration applied?)", 503);
  return (data || []) as AgentKeySummary[];
}
