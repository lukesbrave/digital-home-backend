-- Refuse schema-name collisions. The migration runner skips already-recorded files.
DO $$ BEGIN
  if to_regclass('public.agent_keys') is not null then raise exception 'Starter 3.0: existing agent_keys table requires a reviewed adoption; no automatic replacement'; end if;
END $$;

-- Agent keys — one API key per agent, with scopes, minted and revoked by the
-- owner (see AGENT-KEYS.md).
--
-- The plaintext key (bbk_<name>_<32 hex>) is shown ONCE, in the response to
-- the mint request, and never stored. This table keeps only its sha256 hex
-- digest, which is what an incoming x-api-key is hashed and looked up by, plus
-- a short display prefix so the owner can tell keys apart. Lose the plaintext
-- and the key is gone: revoke it and mint another.
--
-- The env-var keys (API_SECRET_KEY, CONTENT_AGENT_API_KEY, …)
-- are unaffected and keep working; they are checked first and hold every scope.

create table if not exists public.agent_keys (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,                 -- the agent this key belongs to, e.g. 'simon'
  key_prefix   text not null,                 -- display only, e.g. 'bbk_simon_1a2b'
  key_hash     text not null unique,          -- sha256 hex of the plaintext; the plaintext is never stored
  scopes       text[] not null,               -- e.g. {events:read,money:read}; never '*'
  created_at   timestamptz not null default now(),
  created_by   text,                          -- 'master' or 'user:<id>'
  last_used_at timestamptz,                   -- touched at most once per 10 minutes
  revoked_at   timestamptz,                   -- set on revoke; a revoked key never authenticates again
  note         text
);

-- One ACTIVE key per name. Revoked rows stay as the audit trail, so a name
-- can be minted again after its key is revoked (that is how a key rotates).
create unique index if not exists agent_keys_active_name_idx
  on public.agent_keys (name) where revoked_at is null;

comment on table public.agent_keys is
  'Per-agent API keys with scopes. Plaintext shown once at mint, never stored; only its sha256 is kept.';
comment on column public.agent_keys.key_hash is
  'sha256 hex digest of the plaintext key. The plaintext itself is never written anywhere.';
comment on column public.agent_keys.key_prefix is
  'First characters of the key, for display only. Not enough to authenticate.';

-- Service-role only, same posture as other owner-only tables: the
-- auth path and the owner routes run with the service key; nothing reads this
-- table from a browser.
alter table public.agent_keys enable row level security;
revoke all on public.agent_keys from anon, authenticated;
grant all on public.agent_keys to service_role;
