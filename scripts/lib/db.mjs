/**
 * db.mjs — the database half of the migration tools. Same inputs and
 * connection order as scripts/apply-migration.mjs: the project ref comes
 * from SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) in .env.local, the password
 * from SUPABASE_DB_PASSWORD; the direct host is tried first (IPv6), then the
 * session poolers (IPv4).
 */
import { existsSync, readFileSync } from 'node:fs';
import { catalogFromRows, checksum } from './migrations.mjs';

/** Parses .env.local the way apply-migration.mjs does, tolerating CRLF and quotes. */
export function readEnvFile(path) {
  const env = {};
  if (!existsSync(path)) return env;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^(?:export\s+)?([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^"(.*)"$|^'(.*)'$/, '$1$2');
  }
  return env;
}

export function projectRefFromEnv(env) {
  const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  try {
    return new URL(url).hostname.split('.')[0] || null;
  } catch {
    return null;
  }
}

const POOLER_REGIONS = ['ap-southeast-2', 'ap-southeast-1', 'us-east-1', 'us-west-1', 'eu-central-1'];

/** Connects, logging each attempt through `log` (stderr for --json callers). */
export async function connect(ref, password, log = console.log) {
  if (!password) throw new Error('SUPABASE_DB_PASSWORD not set (find it in your Supabase project settings)');
  let pg;
  try {
    pg = (await import('pg')).default;
  } catch {
    throw new Error('The pg package is not installed. Run npm install in the backend folder first.');
  }
  const candidates = [
    { host: `db.${ref}.supabase.co`, port: 5432, user: 'postgres' },
    ...POOLER_REGIONS.map((r) => ({ host: `aws-0-${r}.pooler.supabase.com`, port: 5432, user: `postgres.${ref}` })),
  ];
  for (const c of candidates) {
    const attempt = new pg.Client({
      host: c.host,
      port: c.port,
      user: c.user,
      password,
      database: 'postgres',
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 8000,
    });
    try {
      await attempt.connect();
      log(`Connected via ${c.host}`);
      return attempt;
    } catch (e) {
      log(`  ${c.host}: ${e.code || e.message}`);
    }
  }
  throw new Error('Could not connect to the database on any host.');
}

/**
 * Reads the history table (null when it does not exist yet) and the public
 * schema catalog, inside a read-only transaction.
 */
export async function readState(client) {
  await client.query('begin transaction read only');
  try {
    const { rows: [{ exists }] } = await client.query(
      "select to_regclass('public.schema_migrations') is not null as exists",
    );
    const history = exists
      ? (await client.query('select name, repo, checksum, applied_at, applied_by from schema_migrations order by name')).rows
      : null;
    const tables = (await client.query(
      "select table_name from information_schema.tables where table_schema = 'public'",
    )).rows;
    const columns = (await client.query(
      "select table_name, column_name from information_schema.columns where table_schema = 'public'",
    )).rows;
    const policies = (await client.query(
      "select tablename, policyname from pg_policies where schemaname = 'public'",
    )).rows;
    return { history, catalog: catalogFromRows({ tables, columns, policies }) };
  } finally {
    await client.query('rollback').catch(() => {});
  }
}

export const INSERT_HISTORY =
  'insert into schema_migrations (name, repo, checksum, applied_by) values ($1, $2, $3, $4) on conflict (name) do nothing';

/**
 * Applies one migration and records it, in one transaction (as
 * apply-migration.mjs does). `record` is false only for a release that has
 * no schema_migrations table to record into.
 */
export async function applyAndRecord(client, migration, appliedBy, record = true) {
  try {
    await client.query('begin');
    await client.query(migration.sql);
    if (record) await client.query(INSERT_HISTORY, [migration.name, migration.repo, checksum(migration.sql), appliedBy]);
    await client.query('commit');
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw new Error(`${migration.name} failed (rolled back): ${e.message}`);
  }
}
