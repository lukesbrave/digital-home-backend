#!/usr/bin/env node
/**
 * apply-migration.mjs — run one SQL migration file against the Supabase Postgres,
 * in one transaction.
 *
 * Usage:
 *   node scripts/apply-migration.mjs path/to/migration.sql [--project-ref <ref>] [--password-stdin]
 *
 * The project comes from SUPABASE_URL in the repo's .env.local and is printed
 * before anything runs; pass --project-ref to have it refused unless it
 * matches. The database password comes from SUPABASE_DB_PASSWORD, one line on
 * stdin with --password-stdin, or a hidden prompt; never from the command.
 * Connections verify the server's certificate (SUPABASE_CA_CERT, see
 * scripts/lib/db.mjs) and time out on locks and long statements, as the
 * upgrade tools do. Tries the direct DB host first (IPv6), then the session
 * poolers (IPv4).
 *
 * This does not write to schema_migrations: record the file afterwards with
 * scripts/migrations-seed.mjs.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { applyAndRecord, connect } from './lib/db.mjs';
import { backendRoots } from './lib/context.mjs';
import { describeEnv, getPassword, loadEnv, PASSWORD_HELP } from './lib/env.mjs';
import { checksum, parseArgs } from './lib/migrations.mjs';

let args;
try {
  args = parseArgs(process.argv.slice(2), ['project-ref']);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
const file = args._[0];
if (!file) {
  console.error('Usage: node scripts/apply-migration.mjs <file.sql> [--project-ref <ref>]');
  process.exit(1);
}
const sql = readFileSync(file, 'utf8');

const envFile = loadEnv(backendRoots());
console.log(`Database: ${describeEnv(envFile)}`);
if (!envFile.ref) process.exit(1);
if (typeof args['project-ref'] === 'string' && args['project-ref'] !== envFile.ref) {
  console.error(`--project-ref ${args['project-ref']} does not match the database in .env.local ("${envFile.ref}"). Nothing was changed.`);
  process.exit(2);
}

const password = await getPassword(args);
if (!password) {
  console.error(PASSWORD_HELP);
  process.exit(1);
}

let client;
try {
  client = await connect(envFile.ref, password);
  await applyAndRecord(client, { name: basename(file), repo: 'backend', sql, checksum: checksum(sql) }, null, false);
  console.log(`Applied ${file}`);
  console.log('Not recorded in schema_migrations. Record it with: node scripts/migrations-seed.mjs --project-ref ' + envFile.ref + ' --yes');
} catch (e) {
  console.error(`Migration failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await client?.end().catch(() => {});
}
