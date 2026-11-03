#!/usr/bin/env node
/**
 * migrations-status.mjs — what this Home's database has applied. Read-only.
 *
 * Usage:
 *   node scripts/migrations-status.mjs [--frontend <path>] [--json] [--password-stdin]
 *
 * The project comes from SUPABASE_URL in the repo's .env.local, as
 * scripts/apply-migration.mjs reads it. The password comes from
 * SUPABASE_DB_PASSWORD, --password-stdin, or a hidden prompt; never from the
 * command line. Lists every migration in this repo and in the frontend
 * checkout (--frontend, else a sibling folder named like the frontend repo,
 * else skipped with a notice) and reports each:
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
import { describeEnv, getPassword, PASSWORD_HELP } from './lib/env.mjs';
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
log(`Database: ${describeEnv(ctx.envFile)}`);
if (!ctx.ref) process.exit(1);
for (const n of ctx.notices) log(`Notice: ${n}`);

const password = await getPassword(args);
if (!password) {
  console.error(PASSWORD_HELP);
  process.exit(1);
}

let client;
try {
  client = await connect(ctx.ref, password, log);
  const { history, catalog } = await readState(client);
  const states = computeStatus(ctx.migrations, history, catalog);
  const summary = summarise(states);

  if (json) {
    console.log(JSON.stringify({
      projectRef: ctx.ref,
      historyTable: history !== null,
      frontend: { path: ctx.frontend.path, notice: ctx.frontend.notice },
      notices: ctx.notices,
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
    if (summary.partial > 0) console.log('A partial migration needs a human: see "Partly applied migrations" in UPGRADE.md.');
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await client?.end().catch(() => {});
}
