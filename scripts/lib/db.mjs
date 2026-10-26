/**
 * db.mjs — the database half of the migration tools. Same hosts, in the same
 * order, as scripts/apply-migration.mjs: the direct host first (IPv6), then
 * the session poolers (IPv4).
 *
 * Unlike apply-migration.mjs, the server's certificate is verified. Supabase
 * signs database certificates with its own CA: download it from Project
 * Settings → Database → SSL Configuration and point SUPABASE_CA_CERT (or
 * SSL_CERT_FILE, or Node's NODE_EXTRA_CA_CERTS) at the file.
 *
 * Every session waits at most MIGRATION_LOCK_TIMEOUT seconds for a lock
 * (default 5) and MIGRATION_STATEMENT_TIMEOUT seconds per statement
 * (default 60); a migration that hits either is rolled back.
 *
 * scripts/test-upgrade.mjs replaces this module with a fake, so the scripts
 * only reach the database through what it exports.
 */
import { readFileSync } from 'node:fs';
import { rootCertificates } from 'node:tls';
import { catalogFromRows } from './migrations.mjs';

const POOLER_REGIONS = ['ap-southeast-2', 'ap-southeast-1', 'us-east-1', 'us-west-1', 'eu-central-1'];
const CERT_ERRORS = new Set([
  'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_GET_ISSUER_CERT', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID',
]);

function seconds(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export const TIMEOUTS = {
  lock: seconds('MIGRATION_LOCK_TIMEOUT', 5),
  statement: seconds('MIGRATION_STATEMENT_TIMEOUT', 60),
};

function sslOptions() {
  const caFile = process.env.SUPABASE_CA_CERT || process.env.SSL_CERT_FILE;
  if (!caFile) return { rejectUnauthorized: true };
  return { rejectUnauthorized: true, ca: [...rootCertificates, readFileSync(caFile, 'utf8')] };
}

/** Connects with verified TLS and the session timeouts, logging each attempt through `log`. */
export async function connect(ref, password, log = console.log) {
  if (!password) throw new Error('No database password.');
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
  const ssl = sslOptions();
  let certFailures = 0;
  for (const c of candidates) {
    const attempt = new pg.Client({
      host: c.host,
      port: c.port,
      user: c.user,
      password,
      database: 'postgres',
      ssl,
      connectionTimeoutMillis: 8000,
    });
    try {
      await attempt.connect();
      await attempt.query(`set lock_timeout = '${TIMEOUTS.lock}s'`);
      await attempt.query(`set statement_timeout = '${TIMEOUTS.statement}s'`);
      log(`Connected via ${c.host} (certificate verified)`);
      return attempt;
    } catch (e) {
      if (CERT_ERRORS.has(e.code)) certFailures += 1;
      log(`  ${c.host}: ${e.code || e.message}`);
      await attempt.end().catch(() => {});
    }
  }
  if (certFailures) {
    throw new Error(
      'Could not verify the database certificate. Download the CA certificate from Supabase (Project Settings → Database → SSL Configuration) and set SUPABASE_CA_CERT=/path/to/prod-ca-2021.crt.',
    );
  }
  throw new Error('Could not connect to the database on any host.');
}

/** Names a lock or statement timeout so the reader knows nothing was left half-done. */
export function explainError(e) {
  if (e.code === '55P03') return `waited more than ${TIMEOUTS.lock}s for a lock (another session is using the table; retry when it is quiet)`;
  if (e.code === '57014') return `a statement ran longer than ${TIMEOUTS.statement}s (raise MIGRATION_STATEMENT_TIMEOUT if it needs longer)`;
  return e.message;
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
      ? (await client.query('select name, repo, checksum, applied_at, applied_by from schema_migrations order by repo, name')).rows
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

const INSERT_HISTORY =
  'insert into schema_migrations (repo, name, checksum, applied_by) values ($1, $2, $3, $4) on conflict (repo, name) do nothing returning name';

/**
 * Applies one migration and records it, in one transaction (as
 * apply-migration.mjs does). If the record already exists the whole
 * transaction is rolled back: something else applied it meanwhile.
 * `record` is false only for a release that has no schema_migrations table.
 */
export async function applyAndRecord(client, migration, appliedBy, record = true) {
  try {
    await client.query('begin');
    await client.query(migration.sql);
    if (record) {
      const { rowCount } = await client.query(INSERT_HISTORY, [migration.repo, migration.name, migration.checksum, appliedBy]);
      if (rowCount !== 1) throw new Error('schema_migrations already has a row for it; another session applied it meanwhile');
    }
    await client.query('commit');
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw new Error(`${migration.name} failed and was rolled back: ${explainError(e)}`);
  }
}

/**
 * The seed's single transaction: create the table from `createSql` when
 * given, then insert `rows`. Returns which rows were inserted and which
 * already existed (left unchanged).
 */
export async function seedHistory(client, { createSql, rows }) {
  const inserted = [];
  const existing = [];
  try {
    await client.query('begin');
    if (createSql) await client.query(createSql);
    for (const r of rows) {
      const { rowCount } = await client.query(INSERT_HISTORY, [r.repo, r.name, r.checksum, r.applied_by]);
      (rowCount === 1 ? inserted : existing).push(r);
    }
    await client.query('commit');
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw new Error(`Seed failed and was rolled back, nothing written: ${explainError(e)}`);
  }
  return { inserted, existing };
}
