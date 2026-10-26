/**
 * db.mjs — the database half of the migration tools. Same hosts, in the same
 * order, as scripts/apply-migration.mjs: the direct host first (IPv6), then
 * the session poolers (IPv4).
 *
 * The server's certificate is verified. Supabase signs database
 * certificates with its own root, which Node does not trust, so a copy ships
 * in scripts/certs/supabase-root-2021-ca.crt and is trusted alongside Node's
 * roots. SUPABASE_CA_CERT or SSL_CERT_FILE adds a further CA file (Node's own
 * NODE_EXTRA_CA_CERTS works too); none of them replaces the bundled one.
 *
 * The bundled root (CN "Supabase Root 2021 CA", O Supabase Inc, valid
 * 2021-04-28 to 2031-04-26) was captured from live TLS handshakes with the
 * session poolers on 2026-10-26, identical in ap-southeast-1, ap-southeast-2,
 * ap-northeast-1, us-east-1 and eu-central-1. Its SHA-256 fingerprint is
 *   80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA
 * and scripts/test-upgrade.mjs pins it. To compare it with the certificate
 * your project offers (Project Settings → Database → SSL Configuration):
 *   openssl x509 -in prod-ca-2021.crt -noout -sha256 -fingerprint
 * (-sha256 before -fingerprint). It expires 2031-04-26; replace it before then.
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
import { fileURLToPath } from 'node:url';
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

export const BUNDLED_CA = fileURLToPath(new URL('../certs/supabase-root-2021-ca.crt', import.meta.url));

/** Node's roots, the bundled Supabase root, and any CA file named in the environment. */
export function sslOptions(env = process.env) {
  const ca = [...rootCertificates, readFileSync(BUNDLED_CA, 'utf8')];
  for (const file of [env.SUPABASE_CA_CERT, env.SSL_CERT_FILE]) if (file) ca.push(readFileSync(file, 'utf8'));
  return { rejectUnauthorized: true, ca };
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
      'Could not verify the database certificate against Node\'s roots and the bundled Supabase root (scripts/certs). If Supabase has changed its CA, download the one in Project Settings → Database → SSL Configuration and set SUPABASE_CA_CERT=/path/to/prod-ca-2021.crt.',
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
