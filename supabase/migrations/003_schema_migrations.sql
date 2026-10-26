-- Migration 003: schema history.
--
-- One row per migration file applied to this database, from either starter:
-- the frontend's 001-011 and this repo's own files share the one Supabase
-- project, so both are recorded here, told apart by `repo`.
--
-- Rows are written by scripts/upgrade.mjs as it applies each migration and,
-- once for a Home that predates this table, by scripts/migrations-seed.mjs.
-- scripts/migrations-status.mjs reads it. Service role only: RLS is on with
-- no policies, and the anon and authenticated roles hold no grants.
--
-- Written to be re-runnable.

create table if not exists schema_migrations (
  repo text not null check (repo in ('frontend', 'backend')),
  name text not null,                       -- the file name, e.g. '002_crm_core.sql'
  checksum text,                            -- 'sha256:<hex>' of the file, line endings normalised
  applied_at timestamptz not null default now(),
  applied_by text,                          -- e.g. 'upgrade:v3.0.0' or 'seed:2026-10-26'
  primary key (repo, name)                  -- both repos number from 001
);

alter table schema_migrations enable row level security;

revoke all on table schema_migrations from anon, authenticated;
grant all on table schema_migrations to service_role;
