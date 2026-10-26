#!/usr/bin/env node
/**
 * migrations-status.mjs — what this Home's database has applied. Read-only.
 *
 * Usage:
 *   SUPABASE_DB_PASSWORD=… node scripts/migrations-status.mjs [--frontend <path>] [--json]
 *
 * Same inputs as scripts/apply-migration.mjs: the project from SUPABASE_URL in
 * .env.local, the password from SUPABASE_DB_PASSWORD. Lists every migration in
 * this repo and in the frontend checkout (--frontend, else a sibling folder
 * named like the frontend repo, else skipped with a notice) and reports each:
 *
 *   applied   recorded in schema_migrations
 *   inferred  not recorded, but every table/column/policy it creates exists
 *   partial   not recorded, and only some of what it creates exists
 *   pending   not recorded and nothing it creates exists
 *
 * Exits 0 whenever it could read the database. Runs in a read-only transaction.
 */
import { connect, readState } from './lib/db.mjs';
import { loadContext } from './lib/context.mjs';
import { computeStatus, formatTable, parseArgs, statusRows, summarise } from './lib/migrations.mjs';

let args;
try {
  args = parseArgs(process.argv.slice(2), ['frontend']);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
const json = args.json === true;
const log = json ? (...a) => console.error(...a) : console.log;

const ctx = loadContext(args);
if (!ctx.ref) {
  console.error('Could not read the Supabase project from .env.local (SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL).');
  process.exit(1);
}
log(`Database: Supabase project ${ctx.ref} (from .env.local)`);
if (ctx.frontend.notice) log(`Notice: ${ctx.frontend.notice}`);

let client;
try {
  client = await connect(ctx.ref, ctx.password, log);
  const { history, catalog } = await readState(client);
  const states = computeStatus(ctx.migrations, history, catalog);
  const summary = summarise(states);

  if (json) {
    console.log(JSON.stringify({
      projectRef: ctx.ref,
      historyTable: history !== null,
      frontend: { path: ctx.frontend.path, notice: ctx.frontend.notice },
      summary,
      migrations: states,
    }, null, 2));
  } else {
    console.log('');
    console.log(formatTable(statusRows(states), ['repo', 'migration', 'status', 'detail']));
    console.log('');
    console.log(`${summary.applied} applied, ${summary.inferred} inferred, ${summary.partial} partial, ${summary.pending} pending.`);
    if (history === null) console.log('No schema_migrations table yet: nothing is recorded, so applied migrations show as inferred.');
    if (summary.inferred > 0) console.log('Record the inferred ones once with scripts/migrations-seed.mjs.');
    if (summary.partial > 0) console.log('A partial migration needs a human: compare its file with the database before applying anything.');
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
} finally {
  await client?.end().catch(() => {});
}
