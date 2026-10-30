#!/usr/bin/env node
/**
 * upgrade.mjs — the scripted part of upgrading a Home's backend to a newer
 * starter release. It stops before deploy and never merges the branch,
 * deploys, or deletes anything.
 *
 * Usage (from the backend folder):
 *   node scripts/upgrade.mjs --dry-run                 see every step, change nothing
 *   node scripts/upgrade.mjs [--to v3.1.0]             do the code steps; stops at the database gate
 *   node scripts/upgrade.mjs --project-ref <ref> --yes [--frontend ../frontend]
 *
 * Steps:
 *   1. Preflight: this is a backend fork (src/app/api/write-article) with a clean tree.
 *   2. Add or fetch the `starter` remote and its tags.
 *   3. Pick the target: --to, else the newest vX.Y.Z tag.
 *   4. Create branch upgrade/v<target>, or resume on it.
 *   5. Check that these tools are the target's own copy; stop if not.
 *   6. Check out every file that is new in the target since the VERSION tag
 *      and absent here, and commit them on the branch.
 *   7. List the changed files to merge by hand, each with its git diff.
 *   8. Read the database and apply the target's pending backend migrations,
 *      one transaction each, recording each in schema_migrations: only after
 *      printing the database ref and receiving --project-ref <that ref> --yes.
 *   9. Copy src/types/database.ts to the frontend checkout (--frontend),
 *      when that checkout is clean and on its own branch.
 *  10. Keep VERSION unchanged until the upgrade is verified.
 *  11. Print the checks to run. Deploying is a separate, approved step.
 *
 * --dry-run writes nothing: no remote, tag, branch, file, commit, FETCH_HEAD
 * or database change. To plan from tags it has not fetched it may download
 * their objects, which nothing references.
 *
 * Other flags: --take-untouched also checks out changed files this repo has
 * never edited since the VERSION tag; --starter-url <url> overrides the
 * starter remote; --no-fetch plans from tags already fetched;
 * --password-stdin reads the database password from stdin. The password is
 * otherwise SUPABASE_DB_PASSWORD or a hidden prompt, never an argument.
 *
 * Exit codes: 0 done (or nothing to do), 2 stopped at a gate (re-run to
 * resume), 1 refused or failed.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyAndRecord, connect, readState } from './lib/db.mjs';
import { loadContext } from './lib/context.mjs';
import { describeEnv, getPassword, PASSWORD_HELP } from './lib/env.mjs';
import {
  HISTORY_MIGRATION,
  MIGRATION_FILE,
  checksum,
  classifyDiff,
  compareVersions,
  computeStatus,
  formatTable,
  markersFor,
  parseArgs,
  planFiles,
  planMigrations,
  releaseTags,
  shq,
  writeGate,
} from './lib/migrations.mjs';

const STARTER_URL = 'https://github.com/lukesbrave/digital-home-backend.git';
const MIGRATIONS_DIR = 'supabase/migrations/';
const TYPES = 'src/types/database.ts';
const TOOLS = ['scripts/upgrade.mjs', 'scripts/migrations-status.mjs', 'scripts/migrations-seed.mjs'];

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

function git(gitArgs, { allowFail = false, cwd = root } = {}) {
  try {
    return execFileSync('git', gitArgs, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
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
for (const n of ctx.notices) console.log(`Notice: ${n}`);

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
else if (existing !== url) stop(1, 'Starter remote differs from the expected repository. Review it and provide --starter-url explicitly if intentional.');
else console.log(`  Remote starter: ${existing}`);
const source = existing || (dry ? url : 'starter');

/** Remote release tags → peeled commit ids, from `git ls-remote` (writes nothing). */
let remoteTags = new Map();
if (args['no-fetch'] === true) console.log('  --no-fetch: using the tags already here.');
else if (dry) {
  console.log(`  $ git ls-remote --tags ${shq(source)}`);
  for (const line of git(['ls-remote', '--tags', source]).split('\n')) {
    const [sha, ref] = line.split('\t');
    if (!ref) continue;
    const tag = ref.replace(/^refs\/tags\//, '').replace(/\^\{\}$/, '');
    if (ref.endsWith('^{}') || !remoteTags.has(tag)) remoteTags.set(tag, sha);
  }
} else {
  console.log('  $ git fetch starter --tags');
  git(['fetch', 'starter', '--tags']);
}

// ── 3. Target ────────────────────────────────────────────────────────────────
step('Target release');
const localCommit = (tag) => git(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`], { allowFail: true })?.trim() || null;
/** A tag's commit: local, or (dry run) the remote's, downloading its objects without writing a ref. */
function resolveTag(tag) {
  const local = localCommit(tag);
  if (local) return local;
  const remote = remoteTags.get(tag);
  if (!remote) return null;
  git(['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', source, `refs/tags/${tag}`]);
  return git(['rev-parse', '--verify', '--quiet', `${remote}^{commit}`], { allowFail: true })?.trim() || null;
}
const tags = releaseTags([git(['tag', '--list', 'v*']), ...remoteTags.keys()].join('\n'));
const requested = typeof args.to === 'string' ? args.to.replace(/^v/, '') : null;
if (requested && !/^\d+\.\d+\.\d+$/.test(requested)) stop(1, `--to ${args.to} is not a release version (vX.Y.Z).`);
const target = requested ?? tags[0]?.slice(1);
if (!target) stop(1, 'No release tags found. Check the starter remote.');
const cur = `v${current}`;
const tgt = `v${target}`;
if (compareVersions(target, current) <= 0) stop(0, `Already at ${current}; ${tgt} is not newer. Nothing to upgrade.`);
const R = { cur: resolveTag(cur), tgt: resolveTag(tgt) };
if (!R.tgt) stop(1, `Tag ${tgt} not found.`);
if (!R.cur) stop(1, `VERSION reads ${current} but tag ${cur} is not here, so the release diff cannot be computed. Follow UPGRADE.md by hand.`);
const targetVersion = git(['show', `${R.tgt}:VERSION`], { allowFail: true })?.trim();
if (targetVersion !== target) stop(1, `VERSION inside ${tgt} does not match its tag; refusing the upgrade.`);
console.log(`  ${cur} → ${tgt}`);

// ── 4. Branch ────────────────────────────────────────────────────────────────
step('Upgrade branch');
const branch = `upgrade/${tgt}`;
const onBranch = git(['branch', '--show-current']).trim();
const resuming = onBranch === branch;
if (resuming) console.log(`  Already on ${branch}: resuming.`);
else if (git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { allowFail: true }) !== null) {
  stop(1, `Branch ${branch} already exists. To resume it: git checkout ${branch}, then run this again.`);
} else change(['checkout', '-b', branch]);

// ── 5. Tools ─────────────────────────────────────────────────────────────────
step(`Upgrade tools from ${tgt}`);
const trees = { HEAD: lsTree('HEAD'), [R.cur]: lsTree(R.cur), [R.tgt]: lsTree(R.tgt) };
const toolPaths = [...trees[R.tgt].keys()].filter((p) => TOOLS.includes(p) || /^scripts\/(lib\/[^/]+\.mjs|certs\/[^/]+)$/.test(p));
const staleTools = toolPaths.filter((p) => trees.HEAD.get(p) !== trees[R.tgt].get(p));
if (!toolPaths.length) console.log(`  ${tgt} carries no upgrade tools; using these.`);
else if (!staleTools.length) console.log(`  These tools are ${tgt}'s own copy.`);
else {
  const cmds = [
    // A real run is on the branch by now (step 4 made it); only a dry run is not.
    ...(dry && !resuming ? [`git checkout -b ${branch}`] : []),
    `git checkout ${tgt} -- ${staleTools.map(shq).join(' ')}`,
    `git commit -m "Bring in the upgrade tools from ${tgt}"`,
    `node scripts/upgrade.mjs --to ${tgt}`,
  ];
  const msg = `This Home runs a different copy of the upgrade tools than ${tgt} carries (${staleTools.join(', ')}). Take ${tgt}'s copy first, then run it:\n${cmds.map((c) => `  ${c}`).join('\n')}`;
  if (!dry) stop(1, msg);
  console.log(`  ${msg.replace(/\n/g, '\n  ')}\n  (A real run would stop here; this dry run continues with the current tools.)`);
}

// ── 6. New files ─────────────────────────────────────────────────────────────
step(`Files new in ${tgt}`);
const diff = classifyDiff(git(['diff', '--name-status', '--no-renames', R.cur, R.tgt]));
const plan = planFiles(diff, (ref, path) => trees[ref].get(path) ?? null, { current: R.cur, target: R.tgt });
const take = [...plan.checkout, ...(args['take-untouched'] === true ? plan.untouched : [])];
console.log(`  ${diff.added.length} added, ${diff.modified.length} changed, ${diff.deleted.length} removed upstream between ${cur} and ${tgt}.`);
if (plan.present.length) console.log(`  Already here and identical: ${plan.present.length} file(s).`);
if (take.length) {
  for (const p of take) console.log(`    + ${p}${plan.untouched.includes(p) ? '  (unchanged here since ' + cur + ')' : ''}`);
  for (let i = 0; i < take.length; i += 50) change(['checkout', tgt, '--', ...take.slice(i, i + 50)]);
  change(['commit', '-m', `Upgrade to ${tgt}: take ${take.length} file(s) from the starter`, '--', ...take]);
} else console.log('  Nothing new to check out.');

// ── 7. Merges ────────────────────────────────────────────────────────────────
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

// ── 8. Migrations ────────────────────────────────────────────────────────────
step('Database migrations');
const targetMigrationNames = new Set(
  [...trees[R.tgt].keys()]
    .filter((p) => p.startsWith(MIGRATIONS_DIR) && !p.slice(MIGRATIONS_DIR.length).includes('/'))
    .map((p) => p.slice(MIGRATIONS_DIR.length))
    .filter((n) => MIGRATION_FILE.test(n)),
);
const migrationConflicts = plan.conflict.filter((p) => p.startsWith(MIGRATIONS_DIR));
if (migrationConflicts.length) {
  stop(1, `This Home has its own files at the starter's migration paths: ${migrationConflicts.join(', ')}. See "Your own migrations" in UPGRADE.md: number yours 900 or higher.`);
}

/** Backend migrations as the target has them: the working tree, or the tag when a dry run has not checked them out. */
function backendMigrations() {
  const local = new Map(ctx.migrations.filter((m) => m.repo === 'backend').map((m) => [m.name, m]));
  for (const name of targetMigrationNames) {
    if (local.has(name)) continue;
    const sql = git(['show', `${R.tgt}:${MIGRATIONS_DIR}${name}`]);
    local.set(name, { name, repo: 'backend', path: null, sql, checksum: checksum(sql), markers: markersFor('backend', name, sql), starterOwned: Number(name.slice(0, 3)) < 900 });
  }
  return [...local.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const added = diff.added.filter((p) => p.startsWith(MIGRATIONS_DIR)).map((p) => p.slice(MIGRATIONS_DIR.length));
console.log(`  ${tgt} ${added.length ? 'adds ' + added.join(', ') : 'adds no migration'}; every pending one is checked, whichever release brought it.`);
console.log(`  Database: ${describeEnv(ctx.envFile)}`);
if (!ctx.ref) stop(1, 'Set SUPABASE_URL in the repo\'s .env.local so the database can be identified.');
const password = await getPassword(args);
if (!password) {
  if (dry) console.log(`  [dry-run] ${PASSWORD_HELP} The database was not read.`);
  else stop(2, `${PASSWORD_HELP}\nThen resume:\n  ${resumeCommand(target)}`);
} else {
  const migrations = [...ctx.migrations.filter((m) => m.repo === 'frontend'), ...backendMigrations()];
  let client;
  try {
    client = await connect(ctx.ref, password, (m) => console.log(`  ${m}`));
    const { history, catalog } = await readState(client);
    const states = computeStatus(migrations, history, catalog);
    const mplan = planMigrations(states, targetMigrationNames);
    for (const w of mplan.warnings) console.log(`  Warning: ${w.message}.`);
    if (mplan.blocking.length) {
      stop(1, `Partly applied, so nothing is applied until a human resolves it (see "Partly applied migrations" in UPGRADE.md):\n${mplan.blocking.map((s) => `  ${s.repo}/${s.name}: missing ${s.markers.missing.join(', ')}`).join('\n')}`);
    }
    for (const s of mplan.notOurs) {
      console.log(`  Not applied by this script: ${s.repo}/${s.name} is pending (${s.repo === 'frontend' ? 'the frontend upgrade owns it' : 'not part of ' + tgt}).`);
    }
    if (!mplan.toApply.length) console.log('  Nothing pending: every migration in the target is applied.');
    else {
      console.log('  Pending, to apply in order (one transaction each, recorded in schema_migrations):');
      console.log(formatTable(mplan.toApply.map((s) => [s.name, s.checksum.slice(0, 19) + '…']), ['migration', 'checksum']).replace(/^/gm, '    '));
      const gate = writeGate({ envRef: ctx.ref, projectRef: args['project-ref'], yes: args.yes });
      if (dry) {
        console.log(`  [dry-run] would apply ${mplan.toApply.length} migration(s) to ${ctx.ref}${gate ? ' once confirmed with --project-ref ' + ctx.ref + ' --yes' : ''}.`);
      } else if (gate) {
        stop(2, `${gate}\nTo resume:\n  ${resumeCommand(target)}`);
      } else {
        let recordable = history !== null;
        const byName = new Map(migrations.filter((m) => m.repo === 'backend').map((m) => [m.name, m]));
        for (const s of mplan.toApply) {
          if (s.name === HISTORY_MIGRATION) recordable = true;
          await applyAndRecord(client, byName.get(s.name), `upgrade:${tgt}`, recordable);
          console.log(`  Applied ${s.name}${recordable ? ' and recorded it' : ' (no schema_migrations in this release: not recorded)'}`);
        }
      }
    }
    if (mplan.unrecorded.length) {
      console.log(`  ${mplan.unrecorded.length} migration(s) were applied before history was kept. Record them once:`);
      console.log(`    node scripts/migrations-seed.mjs --project-ref ${ctx.ref} --yes${typeof args.frontend === 'string' ? ' --frontend ' + shq(args.frontend) : ''}`);
    }
  } catch (e) {
    stop(1, `${e.message}\nMigrations already applied stay applied and recorded; fix the cause and re-run to continue.`);
  } finally {
    await client?.end().catch(() => {});
  }
}

// ── 9. Shared types ──────────────────────────────────────────────────────────
step('Shared database types');
const typesNeedWork = [...plan.merge, ...plan.conflict].includes(TYPES) ? 'its merge' : untaken.includes(TYPES) ? 'to be taken' : null;
if (typeof args.frontend !== 'string') {
  console.log(`  No --frontend given. ${TYPES} must stay byte-identical in the frontend: copy it there once merged.`);
} else if (!ctx.frontend.path) {
  console.log(`  ${ctx.frontend.notice}`);
} else {
  const fe = ctx.frontend.path;
  const dest = join(fe, TYPES);
  const source = join(root, TYPES);
  const feBranch = git(['branch', '--show-current'], { cwd: fe, allowFail: true })?.trim();
  const feDirty = git(['status', '--porcelain'], { cwd: fe, allowFail: true });
  if (typesNeedWork) {
    console.log(`  ${TYPES} still needs ${typesNeedWork} (step 7). After that: cp ${TYPES} ${shq(dest)}`);
  } else if (existsSync(dest) && readFileSync(dest, 'utf8') === readFileSync(source, 'utf8')) {
    console.log(`  ${dest} is already identical.`);
  } else if (feDirty === null || feBranch === undefined) {
    console.log(`  ${fe} is not a git checkout; not copying. Copy ${TYPES} there by hand and commit it.`);
  } else if (feDirty.trim()) {
    console.log(`  ${fe} has uncommitted changes; not copying over them. Commit or move them, then: cp ${TYPES} ${shq(dest)}`);
  } else if (!feBranch || ['main', 'master'].includes(feBranch)) {
    console.log(`  ${fe} is ${feBranch ? 'on ' + feBranch : 'not on a branch'}; not copying. First: git -C ${shq(fe)} checkout -b ${branch}, then run this again or cp ${TYPES} ${shq(dest)}`);
  } else if (dry) {
    console.log(`  [dry-run] would copy ${TYPES} to ${dest} (on branch ${feBranch})`);
  } else {
    copyFileSync(source, dest);
    console.log(`  Copied ${TYPES} to ${dest} (branch ${feBranch}). Commit it there:`);
    console.log(`    git -C ${shq(fe)} add ${TYPES} && git -C ${shq(fe)} commit -m "Shared database types from backend ${tgt}"`);
  }
}

// ── 10. VERSION is a completion receipt, not a preparation side effect ────────
step('Installed version remains unchanged');
console.log(`  VERSION stays at ${current}. Preparation is not a verified upgrade.`);
console.log(`  Only after merges, database/media checks, preservation verification and the approved live proof pass, record ${target} in VERSION.`);

// ── 11. Checks ───────────────────────────────────────────────────────────────
step('Checks to run, then stop');
const changed = new Set([...diff.added, ...diff.modified]);
if (changed.has('package.json') || changed.has('package-lock.json')) console.log('  npm install');
console.log('  npx tsc --noEmit');
console.log('  npm run build');
console.log('  node scripts/migrations-status.mjs');
console.log(`\nThis script stops here. Finish the merges on ${branch}, run the checks, commit.`);
console.log('Deploying (DEPLOYMENT.md) and merging the branch are separate steps that need the member\'s approval.');
