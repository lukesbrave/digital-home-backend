#!/usr/bin/env node
/**
 * upgrade.mjs — the scripted part of upgrading a Home's backend to a newer
 * starter release. It stops before deploy and never merges the branch,
 * deploys, or deletes anything.
 *
 * Usage (from the backend folder):
 *   node scripts/upgrade.mjs --dry-run                 see every step, change nothing
 *   node scripts/upgrade.mjs [--to v3.0.0]             do the code steps; stops at the database gate
 *   SUPABASE_DB_PASSWORD=… node scripts/upgrade.mjs --project-ref <ref> --yes [--frontend ../frontend]
 *
 * Steps:
 *   1. Preflight: this is a backend fork (src/app/api/write-article) with a clean tree.
 *   2. Add or fetch the `starter` remote and its tags.
 *   3. Pick the target: --to, else the newest vX.Y.Z tag.
 *   4. Create branch upgrade/v<target>, or resume on it.
 *   5. Check out every file that is new in the target since the VERSION tag
 *      and absent here, and commit them on the branch.
 *   6. List the changed files to merge by hand, each with its git diff.
 *   7. Apply the target's pending backend migrations, one transaction each,
 *      recording each in schema_migrations: only after printing the database
 *      ref and receiving --project-ref <that ref> --yes.
 *   8. Copy src/types/database.ts to the frontend checkout (--frontend).
 *   9. Write VERSION.
 *  10. Print the checks to run. Deploying is a separate, approved step.
 *
 * Other flags: --take-untouched also checks out changed files this repo has
 * never edited since the VERSION tag; --starter-url <url> overrides the
 * starter remote; --no-fetch plans from tags already fetched.
 *
 * Exit codes: 0 done (or nothing to do), 2 stopped at a gate (re-run to
 * resume), 1 refused or failed.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyAndRecord, connect, readState } from './lib/db.mjs';
import { loadContext } from './lib/context.mjs';
import {
  checksum,
  classifyDiff,
  compareVersions,
  computeStatus,
  formatTable,
  markersFor,
  parseArgs,
  planFiles,
  releaseTags,
  shq,
  writeGate,
} from './lib/migrations.mjs';

const STARTER_URL = 'https://github.com/lukesbrave/digital-home-backend.git';
const MIGRATIONS_DIR = 'supabase/migrations/';
const TYPES = 'src/types/database.ts';

let args;
try {
  args = parseArgs(process.argv.slice(2), ['to', 'frontend', 'project-ref', 'starter-url']);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
const dry = args['dry-run'] === true;
const ctx = loadContext(args);
const root = ctx.root;

function git(gitArgs, { allowFail = false } = {}) {
  try {
    return execFileSync('git', gitArgs, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    if (allowFail) return null;
    throw new Error(`git ${gitArgs.join(' ')} failed: ${(e.stderr || e.message).toString().trim()}`);
  }
}

/** Runs a git command that changes something, or only prints it under --dry-run. */
function change(gitArgs) {
  const shown = `git ${gitArgs.map(shq).join(' ')}`;
  if (dry) {
    console.log(`  [dry-run] would run: ${shown}`);
    return;
  }
  console.log(`  $ ${shown}`);
  git(gitArgs);
}

let stepNo = 0;
function step(title) {
  stepNo += 1;
  console.log(`\n${stepNo}. ${title}`);
}

function stop(code, message) {
  if (message) console.log(`\n${message}`);
  process.exit(code);
}

function lsTree(ref) {
  const map = new Map();
  for (const line of git(['ls-tree', '-r', '-z', ref]).split('\0')) {
    if (!line) continue;
    const [meta, path] = line.split('\t');
    map.set(path, meta.split(' ')[2]);
  }
  return map;
}

function resumeCommand(target) {
  const parts = ['node scripts/upgrade.mjs', `--to v${target}`, `--project-ref ${ctx.ref ?? '<ref>'}`, '--yes'];
  if (typeof args.frontend === 'string') parts.push(`--frontend ${shq(args.frontend)}`);
  if (args['take-untouched'] === true) parts.push('--take-untouched');
  if (typeof args['starter-url'] === 'string') parts.push(`--starter-url ${shq(args['starter-url'])}`);
  return parts.join(' ');
}

if (dry) console.log('Dry run: nothing will be changed.');

// ── 1. Preflight ─────────────────────────────────────────────────────────────
step('Preflight');
if (!existsSync(join(root, 'src', 'app', 'api', 'write-article'))) {
  stop(1, `${root} has no src/app/api/write-article: this is not a Digital Home backend. If it is the frontend, stop here.`);
}
const dirty = git(['status', '--porcelain']).trimEnd();
if (dirty) {
  const msg = `The working tree has uncommitted changes. Commit them first so the upgrade can be reverted:\n${dirty}`;
  if (!dry) stop(1, msg);
  console.log(`  ${msg.replace(/\n/g, '\n  ')}\n  (A real run would stop here.)`);
}
const versionFile = join(root, 'VERSION');
if (!existsSync(versionFile)) stop(1, 'No VERSION file: this Home is v1.x. Follow the "Historical upgrades" section of UPGRADE.md instead.');
const current = readFileSync(versionFile, 'utf8').trim();
if (!/^\d+\.\d+\.\d+$/.test(current)) stop(1, `VERSION reads "${current}", which is not a release. Follow UPGRADE.md by hand.`);
console.log(`  Backend at ${root}, VERSION ${current}, tree ${dirty ? 'dirty' : 'clean'}.`);

// ── 2. Starter remote ────────────────────────────────────────────────────────
step('Starter remote and tags');
const url = typeof args['starter-url'] === 'string' ? args['starter-url'] : STARTER_URL;
const existing = git(['remote', 'get-url', 'starter'], { allowFail: true })?.trim();
if (!existing) change(['remote', 'add', 'starter', url]);
else if (existing !== url) console.log(`  Remote starter points at ${existing} (expected ${url}); using it as is.`);
else console.log(`  Remote starter: ${existing}`);
if (args['no-fetch'] === true) console.log('  --no-fetch: using the tags already here.');
else {
  // Fetching only updates tag refs, never the working tree, so a dry run does it too.
  const from = existing || !dry ? 'starter' : url;
  console.log(`  $ git fetch ${shq(from)} --tags`);
  git(['fetch', from, '--tags']);
}

// ── 3. Target ────────────────────────────────────────────────────────────────
step('Target release');
const tags = releaseTags(git(['tag', '--list', 'v*']));
const requested = typeof args.to === 'string' ? args.to.replace(/^v/, '') : null;
if (requested && !/^\d+\.\d+\.\d+$/.test(requested)) stop(1, `--to ${args.to} is not a release version (vX.Y.Z).`);
const target = requested ?? tags[0]?.slice(1);
if (!target) stop(1, 'No release tags found. Check the starter remote.');
const hasTag = (v) => git(['rev-parse', '--verify', '--quiet', `refs/tags/v${v}^{commit}`], { allowFail: true }) !== null;
if (!hasTag(target)) stop(1, `Tag v${target} not found.`);
if (!hasTag(current)) stop(1, `VERSION reads ${current} but tag v${current} is not here, so the release diff cannot be computed. Follow UPGRADE.md by hand.`);
if (compareVersions(target, current) <= 0) stop(0, `Already at ${current}; v${target} is not newer. Nothing to upgrade.`);
const targetVersion = git(['show', `v${target}:VERSION`], { allowFail: true })?.trim();
if (targetVersion !== target) console.log(`  Warning: VERSION inside v${target} reads "${targetVersion}".`);
const cur = `v${current}`;
const tgt = `v${target}`;
console.log(`  ${cur} → ${tgt}`);

// ── 4. Branch ────────────────────────────────────────────────────────────────
step('Upgrade branch');
const branch = `upgrade/${tgt}`;
const onBranch = git(['branch', '--show-current']).trim();
if (onBranch === branch) console.log(`  Already on ${branch}: resuming.`);
else if (git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { allowFail: true }) !== null) {
  stop(1, `Branch ${branch} already exists. To resume it: git checkout ${branch}, then run this again.`);
} else change(['checkout', '-b', branch]);

// ── 5. New files ─────────────────────────────────────────────────────────────
step(`Files new in ${tgt}`);
const diff = classifyDiff(git(['diff', '--name-status', '--no-renames', cur, tgt]));
const trees = { HEAD: lsTree('HEAD'), [cur]: lsTree(cur), [tgt]: lsTree(tgt) };
const plan = planFiles(diff, (ref, path) => trees[ref].get(path) ?? null, { current: cur, target: tgt });
const take = [...plan.checkout, ...(args['take-untouched'] === true ? plan.untouched : [])];
console.log(`  ${diff.added.length} added, ${diff.modified.length} changed, ${diff.deleted.length} removed upstream between ${cur} and ${tgt}.`);
if (plan.present.length) console.log(`  Already here and identical: ${plan.present.length} file(s).`);
if (take.length) {
  for (const p of take) console.log(`    + ${p}${plan.untouched.includes(p) ? '  (unchanged here since ' + cur + ')' : ''}`);
  for (let i = 0; i < take.length; i += 50) change(['checkout', tgt, '--', ...take.slice(i, i + 50)]);
  change(['commit', '-m', `Upgrade to ${tgt}: take ${take.length} file(s) from the starter`, '--', ...take]);
} else console.log('  Nothing new to check out.');

// ── 6. Merges ────────────────────────────────────────────────────────────────
step('Merge by hand');
const untaken = args['take-untouched'] === true ? [] : plan.untouched;
if (!plan.merge.length && !plan.conflict.length && !untaken.length && !plan.removedHere.length) {
  console.log('  No changed file needs a merge.');
}
for (const p of plan.merge) {
  console.log(`  ${p}\n    what the starter changed: git diff ${cur} ${tgt} -- ${shq(p)}\n    what this Home changed:   git diff ${cur} HEAD -- ${shq(p)}`);
}
for (const p of plan.conflict) {
  console.log(`  ${p}  (new in ${tgt}, but this Home already has a different file there)\n    compare: git diff HEAD ${tgt} -- ${shq(p)}`);
}
for (const p of untaken) {
  console.log(`  ${p}  (unchanged here since ${cur}: taking the starter's copy is safe)\n    see: git diff ${cur} ${tgt} -- ${shq(p)}\n    take: git checkout ${tgt} -- ${shq(p)}`);
}
for (const p of plan.removedHere) console.log(`  ${p}  (changed upstream, deleted in this Home: decide whether you still need it)\n    see: git diff ${cur} ${tgt} -- ${shq(p)}`);
if (plan.deletedUpstream.length) {
  console.log(`  Removed from the starter in ${tgt}, left in place here (delete by hand only if nothing uses them):`);
  for (const p of plan.deletedUpstream) console.log(`    ${p}`);
}
if (plan.current.length) console.log(`  Already matching ${tgt}: ${plan.current.length} changed file(s).`);

// ── 7. Migrations ────────────────────────────────────────────────────────────
step('Database migrations');
const targetMigrationNames = new Set(
  git(['ls-tree', '--name-only', `${tgt}:${MIGRATIONS_DIR}`], { allowFail: true })?.split('\n').filter(Boolean) ?? [],
);
const newMigrations = diff.added.filter((p) => p.startsWith(MIGRATIONS_DIR) && p.endsWith('.sql'));
const migrationConflicts = plan.conflict.filter((p) => p.startsWith(MIGRATIONS_DIR));
if (migrationConflicts.length) {
  stop(1, `This Home has its own files at the starter's migration paths: ${migrationConflicts.join(', ')}. Renumber yours to 900+ (see CLAUDE.md) before upgrading.`);
}

/** Backend migrations as the target has them: the working tree, or the tag when a dry run has not checked them out. */
function backendMigrations() {
  const local = new Map(ctx.migrations.filter((m) => m.repo === 'backend').map((m) => [m.name, m]));
  for (const name of targetMigrationNames) {
    if (local.has(name) || !/^\d{3}_.*\.sql$/.test(name)) continue;
    const sql = git(['show', `${tgt}:${MIGRATIONS_DIR}${name}`]);
    local.set(name, { name, repo: 'backend', path: null, sql, checksum: checksum(sql), markers: markersFor('backend', name, sql), starterOwned: true });
  }
  return [...local.values()].sort((a, b) => a.name.localeCompare(b.name));
}

let migrationsPending = false;
if (newMigrations.length === 0) {
  console.log(`  ${tgt} adds no migration.`);
} else {
  console.log(`  ${tgt} adds: ${newMigrations.map((p) => p.slice(MIGRATIONS_DIR.length)).join(', ')}`);
  console.log(`  Database: Supabase project ${ctx.ref ?? '(unknown: no SUPABASE_URL in .env.local)'} (from .env.local)`);
  if (ctx.frontend.notice && typeof args.frontend === 'string') console.log(`  Notice: ${ctx.frontend.notice}`);
  if (!ctx.ref) stop(1, 'Set SUPABASE_URL in .env.local so the database can be identified.');
  if (!ctx.password) {
    if (dry) console.log('  [dry-run] SUPABASE_DB_PASSWORD is not set, so the database was not read; the new files above would be applied if pending.');
    else stop(2, `Set SUPABASE_DB_PASSWORD (the database password, from the Supabase project settings) and re-run:\n  ${resumeCommand(target)}`);
  } else {
    const migrations = [...ctx.migrations.filter((m) => m.repo === 'frontend'), ...backendMigrations()];
    let client;
    try {
      client = await connect(ctx.ref, ctx.password, (m) => console.log(`  ${m}`));
      const { history, catalog } = await readState(client);
      const states = computeStatus(migrations, history, catalog);
      const partial = states.filter((s) => s.status === 'partial');
      if (partial.length) {
        stop(1, `Partly applied, needs a human before anything is applied:\n${partial.map((s) => `  ${s.repo}/${s.name}: missing ${s.markers.missing.join(', ')}`).join('\n')}`);
      }
      const toApply = states.filter((s) => s.repo === 'backend' && s.status === 'pending' && targetMigrationNames.has(s.name));
      const notOurs = states.filter((s) => s.status === 'pending' && !toApply.includes(s));
      for (const s of notOurs) {
        console.log(`  Not applied by this script: ${s.repo}/${s.name} is pending (${s.repo === 'frontend' ? 'the frontend upgrade owns it' : 'not part of ' + tgt}).`);
      }
      const unrecorded = states.filter((s) => s.status === 'inferred');
      if (!toApply.length) console.log('  Nothing pending: every migration in the target is applied.');
      else {
        console.log(`  Pending, to apply in order (one transaction each, recorded in schema_migrations):`);
        console.log(formatTable(toApply.map((s) => [s.name, s.checksum.slice(0, 19) + '…']), ['migration', 'checksum']).replace(/^/gm, '    '));
        const gate = writeGate({ envRef: ctx.ref, projectRef: args['project-ref'], yes: args.yes });
        if (dry) {
          console.log(`  [dry-run] would apply ${toApply.length} migration(s) to ${ctx.ref}${gate ? ' once confirmed with --project-ref ' + ctx.ref + ' --yes' : ''}.`);
          migrationsPending = true;
        } else if (gate) {
          stop(2, `${gate}\nTo resume:\n  ${resumeCommand(target)}`);
        } else {
          let recordable = history !== null;
          const byName = new Map(migrations.filter((m) => m.repo === 'backend').map((m) => [m.name, m]));
          for (const s of toApply) {
            const m = byName.get(s.name);
            if (s.name === '003_schema_migrations.sql') recordable = true;
            await applyAndRecord(client, m, `upgrade:${tgt}`, recordable);
            console.log(`  Applied ${s.name}${recordable ? ' and recorded it' : ' (no schema_migrations in this release: not recorded)'}`);
          }
        }
      }
      if (unrecorded.length) {
        console.log(`  ${unrecorded.length} migration(s) were applied before history was kept. Record them once:`);
        console.log(`    node scripts/migrations-seed.mjs --project-ref ${ctx.ref} --yes${typeof args.frontend === 'string' ? ' --frontend ' + shq(args.frontend) : ''}`);
      }
    } catch (e) {
      stop(1, `${e.message}\nMigrations already applied stay applied and recorded; fix the cause and re-run to continue.`);
    } finally {
      await client?.end().catch(() => {});
    }
  }
}

// ── 8. Shared types ──────────────────────────────────────────────────────────
step('Shared database types');
const typesNeedWork = [...plan.merge, ...plan.conflict].includes(TYPES) ? 'its merge' : untaken.includes(TYPES) ? 'to be taken' : null;
if (typeof args.frontend !== 'string') {
  console.log(`  No --frontend given. ${TYPES} must stay byte-identical in the frontend: copy it there once merged.`);
} else if (!ctx.frontend.path) {
  console.log(`  ${ctx.frontend.notice}`);
} else {
  const dest = join(ctx.frontend.path, TYPES);
  const source = join(root, TYPES);
  if (typesNeedWork) {
    console.log(`  ${TYPES} still needs ${typesNeedWork} (step 6). After that: cp ${TYPES} ${shq(dest)}`);
  } else if (existsSync(dest) && readFileSync(dest, 'utf8') === readFileSync(source, 'utf8')) {
    console.log(`  ${dest} is already identical.`);
  } else if (dry) {
    console.log(`  [dry-run] would copy ${TYPES} to ${dest}`);
  } else {
    copyFileSync(source, dest);
    console.log(`  Copied ${TYPES} to ${dest}. Commit it in the frontend on its own upgrade branch.`);
  }
}

// ── 9. VERSION ───────────────────────────────────────────────────────────────
step('VERSION');
if (dry) console.log(`  [dry-run] would write ${target} to VERSION${migrationsPending ? ' after the migrations' : ''}.`);
else {
  writeFileSync(versionFile, `${target}\n`);
  console.log(`  VERSION now reads ${target} (uncommitted: commit it with your merges).`);
}

// ── 10. Checks ───────────────────────────────────────────────────────────────
step('Checks to run, then stop');
const changed = new Set([...diff.added, ...diff.modified]);
if (changed.has('package.json') || changed.has('package-lock.json')) console.log('  npm install');
console.log('  npx tsc --noEmit');
console.log('  npm run build');
console.log('  node scripts/migrations-status.mjs');
console.log(`\nThis script stops here. Finish the merges on ${branch}, run the checks, commit.`);
console.log('Deploying (DEPLOYMENT.md) and merging the branch are separate steps that need the member\'s approval.');
