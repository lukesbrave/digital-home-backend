#!/usr/bin/env node
/**
 * migrations-seed.mjs — the one-time catch-up for a Home that predates
 * schema_migrations (every 2.x Home). Records each migration that
 * migrations-status.mjs infers as applied, so later upgrades can trust the
 * history instead of guessing.
 *
 * Usage:
 *   node scripts/migrations-seed.mjs --project-ref <ref> --yes [--frontend <path>] [--dry-run] [--password-stdin]
 *
 * Without --project-ref it prints the database ref and stops before
 * connecting, so it can be read aloud and confirmed. With a matching
 * --project-ref it prints the rows it would write and stops. Only
 * --project-ref <ref> --yes writes; --dry-run never writes, even with --yes.
 * When the table does not exist yet it is created from
 * 003_schema_migrations.sql in the same transaction, and 003 is recorded
 * too. Existing rows are never changed. Partial and pending migrations are
 * reported and left alone. The password comes from SUPABASE_DB_PASSWORD,
 * --password-stdin, or a hidden prompt; never from the command line.
 *
 * Exit codes: 0 done, nothing to do, or a dry run; 2 stopped at the
 * confirmation gate; 1 error.
 */
import { connect, readState, seedHistory } from './lib/db.mjs';
import { loadContext } from './lib/context.mjs';
import { describeEnv, getPassword, PASSWORD_HELP } from './lib/env.mjs';
import { HISTORY_MIGRATION, computeStatus, formatTable, parseArgs, seedRows, writeGate } from './lib/migrations.mjs';

let args;
try {
  args = parseArgs(process.argv.slice(2), ['frontend', 'project-ref']);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
const dry = args['dry-run'] === true;

const ctx = loadContext(args);
console.log(`Database: ${describeEnv(ctx.envFile)}`);
for (const n of ctx.notices) console.log(`Notice: ${n}`);
if (dry) console.log('Dry run: nothing will be written.');

// The ref must be confirmed before this script even reads the database.
const refGate = writeGate({ envRef: ctx.ref, projectRef: args['project-ref'], yes: true });
if (refGate) {
  console.log(refGate);
  process.exit(2);
}

const password = await getPassword(args);
if (!password) {
  console.error(PASSWORD_HELP);
  process.exit(1);
}

const date = new Date().toISOString().slice(0, 10);
let client;
try {
  client = await connect(ctx.ref, password);
  const { history, catalog } = await readState(client);
  const states = computeStatus(ctx.migrations, history, catalog);
  const byKey = new Map(ctx.migrations.map((m) => [`${m.repo}/${m.name}`, m]));

  const rows = seedRows(states, byKey, date);
  const historyFile = byKey.get(`backend/${HISTORY_MIGRATION}`);
  const createTable = history === null;
  if (createTable) {
    if (!historyFile) throw new Error('schema_migrations does not exist and supabase/migrations/003_schema_migrations.sql is missing.');
    rows.push({ name: historyFile.name, repo: 'backend', checksum: historyFile.checksum, applied_by: `seed:${date}` });
  }

  const left = states.filter((s) => s.status === 'partial' || s.status === 'pending');
  if (left.length) {
    console.log('\nNot recorded (not applied, or not fully):');
    console.log(formatTable(left.map((s) => [s.repo, s.name, s.status, s.markers.missing.join(', ')]), ['repo', 'migration', 'status', 'missing']));
  }

  if (rows.length === 0) {
    console.log('\nNothing to seed: every applied migration is already recorded.');
  } else {
    console.log('');
    if (createTable) console.log('Will create schema_migrations by running supabase/migrations/003_schema_migrations.sql, then insert:');
    else console.log('Will insert into schema_migrations:');
    console.log(formatTable(rows.map((r) => [r.repo, r.name, r.checksum.slice(0, 19) + '…', r.applied_by]), ['repo', 'name', 'checksum', 'applied_by']));

    const gate = dry ? null : writeGate({ envRef: ctx.ref, projectRef: args['project-ref'], yes: args.yes });
    if (dry) {
      console.log(`\nDry run: ${rows.length} row(s) would be written to ${ctx.ref}. Nothing was written.`);
    } else if (gate) {
      console.log(`\n${gate}`);
      process.exitCode = 2;
    } else {
      const { inserted, existing } = await seedHistory(client, { createSql: createTable ? historyFile.sql : null, rows });
      console.log(`\nRecorded ${inserted.length} migration${inserted.length === 1 ? '' : 's'} in ${ctx.ref}.`);
      if (existing.length) {
        console.log(`Already recorded, left unchanged (another session wrote them meanwhile): ${existing.map((r) => `${r.repo}/${r.name}`).join(', ')}`);
      }
      console.log('Check with: node scripts/migrations-status.mjs');
    }
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await client?.end().catch(() => {});
}
