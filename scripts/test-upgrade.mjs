// Tests for the migration history and upgrade tools. No real database: the
// pure parts are tested directly, and the scripts run against throwaway git
// repos with scripts/lib/db.mjs swapped for a fake that records every call.
//   node --test scripts/test-upgrade.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { consumeHiddenInput, describeEnv, loadEnv, projectRefFromEnv, readEnvFile } from './lib/env.mjs';
import { backendRoots } from './lib/context.mjs';
import {
  KNOWN_MARKERS,
  MIGRATION_FILE,
  catalogFromRows,
  checksum,
  classifyDiff,
  computeStatus,
  extractMarkers,
  findFrontend,
  frontendCandidates,
  listMigrations,
  markerLabel,
  parseArgs,
  planFiles,
  planMigrations,
  releaseTags,
  seedRows,
  skippedFiles,
  summarise,
  writeGate,
} from './lib/migrations.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const labels = (markers) => markers.map(markerLabel).sort();
const TMP = mkdtempSync(join(tmpdir(), 'dh-upgrade-test-'));
after(() => rmSync(TMP, { recursive: true, force: true }));
let n = 0;
const tmp = (name) => {
  const d = join(TMP, `${++n}-${name}`);
  mkdirSync(d, { recursive: true });
  return d;
};

// ── Pure parts ───────────────────────────────────────────────────────────────

test('checksum ignores line endings and a BOM, and changes with the SQL', () => {
  const lf = 'create table a (id int);\nselect 1;\n';
  assert.match(checksum(lf), /^sha256:[0-9a-f]{64}$/);
  assert.equal(checksum(lf), checksum(lf.replace(/\n/g, '\r\n')));
  assert.equal(checksum(lf), checksum('﻿' + lf));
  assert.notEqual(checksum(lf), checksum(lf + ' '));
});

test('extractMarkers reads tables, added columns and policies, not comments', () => {
  const sql = `
    -- create table not_this (id int);
    /* create table nor_this (id int); */
    create table visitors (id uuid);
    CREATE TABLE IF NOT EXISTS public."Quoted_Name" (id int);
    create unlogged table scratch (id int);
    alter table leads add column if not exists phone text, add column company text;
    alter table if exists only email_sends add column variant text check (variant in ('a', 'b'));
    alter table visitors add constraint fk foreign key (lead_id) references leads(id);
    alter table offers enable row level security;
    create policy "Public read active offers" on offers for select using (status = 'active');
    create table visitors (id uuid);
  `;
  assert.deepEqual(labels(extractMarkers(sql)), [
    'column email_sends.variant',
    'column leads.company',
    'column leads.phone',
    'policy "Public read active offers" on offers',
    'table Quoted_Name',
    'table scratch',
    'table visitors',
  ]);
  assert.deepEqual(extractMarkers('insert into backend_settings values (1);'), []);
});

test('KNOWN_MARKERS match the create table statements of the backend files', () => {
  const files = listMigrations(join(ROOT, 'supabase', 'migrations'), 'backend');
  assert.deepEqual(files.map((f) => f.name).slice(0, 3), Object.keys(KNOWN_MARKERS.backend));
  for (const f of files.filter((f) => KNOWN_MARKERS.backend[f.name])) {
    const tables = extractMarkers(f.sql).filter((m) => m.kind === 'table');
    assert.deepEqual(labels(KNOWN_MARKERS.backend[f.name]), labels(tables), f.name);
  }
});

/** The fixture's sections, keyed by the file each came from. */
function frontendExcerpts() {
  const text = readFileSync(join(ROOT, 'scripts', 'fixtures', 'frontend-migrations', '0b9bd81-excerpts.sql'), 'utf8');
  const out = {};
  for (const part of text.split(/^-- file: /m).slice(1)) {
    const nl = part.indexOf('\n');
    out[part.slice(0, nl).trim()] = part.slice(nl + 1);
  }
  return out;
}

test('KNOWN_MARKERS frontend half matches the marker reader run on the vendored 001-011 SQL', () => {
  const excerpts = frontendExcerpts();
  assert.deepEqual(Object.keys(excerpts), Object.keys(KNOWN_MARKERS.frontend));
  for (const [name, sql] of Object.entries(excerpts)) {
    const extracted = extractMarkers(sql);
    const tables = extracted.filter((m) => m.kind === 'table');
    // 011 creates no table: its policies stand in.
    const expected = tables.length ? tables : extracted.filter((m) => m.kind === 'policy');
    assert.ok(expected.length > 0, name);
    assert.deepEqual(labels(KNOWN_MARKERS.frontend[name]), labels(expected), name);
  }
});

test('KNOWN_MARKERS match a frontend checkout next door, when there is one', (t) => {
  const frontend = findFrontend(null, backendRoots(ROOT));
  if (!frontend.path) return t.skip(frontend.notice);
  for (const f of listMigrations(join(frontend.path, 'supabase', 'migrations'), 'frontend')) {
    if (!KNOWN_MARKERS.frontend[f.name]) continue;
    const extracted = extractMarkers(f.sql);
    const tables = extracted.filter((m) => m.kind === 'table');
    const expected = tables.length ? tables : extracted.filter((m) => m.kind === 'policy');
    assert.deepEqual(labels(expected), labels(KNOWN_MARKERS.frontend[f.name]), f.name);
  }
});

test('the bundled Supabase root is the pinned certificate and is trusted alongside Node\'s roots', async () => {
  const { X509Certificate } = await import('node:crypto');
  const { rootCertificates } = await import('node:tls');
  const { BUNDLED_CA, sslOptions } = await import('./lib/db.mjs');
  const pem = readFileSync(join(ROOT, 'scripts', 'certs', 'supabase-root-2021-ca.crt'), 'utf8');
  assert.equal(BUNDLED_CA, join(ROOT, 'scripts', 'certs', 'supabase-root-2021-ca.crt'));
  const cert = new X509Certificate(pem);
  assert.equal(cert.fingerprint256, '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA');
  assert.match(cert.subject, /CN=Supabase Root 2021 CA/);
  assert.equal(cert.subject, cert.issuer, 'a self-signed root');
  assert.equal(cert.ca, true);
  assert.equal(new Date(cert.validTo).toISOString().slice(0, 10), '2031-04-26');
  assert.match(readFileSync(join(ROOT, 'scripts', 'lib', 'db.mjs'), 'utf8'), /80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA/);

  const plain = sslOptions({});
  assert.equal(plain.rejectUnauthorized, true);
  assert.equal(plain.ca.length, rootCertificates.length + 1);
  assert.equal(plain.ca.at(-1), pem);
  const extra = join(tmp('ca'), 'extra.crt');
  writeFileSync(extra, pem);
  assert.equal(sslOptions({ SUPABASE_CA_CERT: extra }).ca.length, rootCertificates.length + 2, 'an override adds, never replaces');
});

test('the hidden prompt ends at the first newline, even when a paste brings it in the same chunk', () => {
  assert.deepEqual(consumeHiddenInput('', 'secret\n'), { value: 'secret', done: true });
  assert.deepEqual(consumeHiddenInput('', 'secret\r\n'), { value: 'secret', done: true });
  assert.deepEqual(consumeHiddenInput('sec', 'ret'), { value: 'secret', done: false });
  assert.deepEqual(consumeHiddenInput('secrex', '\u007ft\r'), { value: 'secret', done: true });
  assert.equal(consumeHiddenInput('', '\u0003').cancelled, true);
});

test('one file name pattern, and the files it skips are listed', () => {
  assert.ok(MIGRATION_FILE.test('002_crm_core.sql'));
  assert.ok(MIGRATION_FILE.test('900_my-feature.sql'));
  assert.ok(!MIGRATION_FILE.test('2_short.sql'));
  assert.ok(!MIGRATION_FILE.test('backup.sql'));
  const dir = tmp('pattern');
  for (const f of ['001_a.sql', 'scratch.sql', '01_b.sql', 'README.md']) writeFileSync(join(dir, f), 'select 1;');
  assert.deepEqual(listMigrations(dir, 'backend').map((m) => m.name), ['001_a.sql']);
  assert.deepEqual(skippedFiles(dir), ['01_b.sql', 'scratch.sql']);
});

const migration = (name, markers, repo = 'backend', sql = `-- ${name}`) => ({
  name, repo, sql, checksum: checksum(sql), markers, starterOwned: Number(name.slice(0, 3)) < 900,
});
const T = (name) => ({ kind: 'table', name });

test('status: applied, inferred, partial and pending', () => {
  const ms = [
    migration('001_a.sql', [T('a')]),
    migration('002_b.sql', [T('b'), { kind: 'column', table: 'leads', name: 'phone' }]),
    migration('003_c.sql', [T('c'), T('c2')]),
    migration('004_d.sql', [T('d')]),
    migration('005_data.sql', []),
    migration('011_policies.sql', [{ kind: 'policy', table: 'offers', name: 'p' }], 'frontend'),
  ];
  const catalog = catalogFromRows({
    tables: ['a', 'b', 'c'].map((table_name) => ({ table_name })),
    columns: [{ table_name: 'leads', column_name: 'phone' }],
    policies: [{ tablename: 'offers', policyname: 'p' }],
  });
  const history = [{ name: '001_a.sql', repo: 'backend', checksum: 'sha256:old', applied_at: new Date('2026-10-01T00:00:00Z'), applied_by: 'upgrade:v3.0.0' }];
  const states = computeStatus(ms, history, catalog);
  assert.deepEqual(states.map((s) => s.status), ['applied', 'inferred', 'partial', 'pending', 'pending', 'inferred']);
  assert.equal(states[0].checksumMatches, false);
  assert.equal(states[0].recorded.applied_at, '2026-10-01T00:00:00.000Z');
  assert.deepEqual(states[2].markers.missing, ['table c2']);
  assert.deepEqual(summarise(states), { applied: 1, inferred: 2, partial: 1, pending: 2 });
});

test('status: a record from the other repo with the same file name does not count', () => {
  const ms = [migration('001_a.sql', [T('a')], 'frontend')];
  const catalog = catalogFromRows({ tables: [{ table_name: 'a' }] });
  assert.equal(computeStatus(ms, null, catalog)[0].status, 'inferred');
  assert.equal(computeStatus(ms, [{ name: '001_a.sql', repo: 'backend', checksum: null }], catalog)[0].status, 'inferred');
});

test('planMigrations: a partial state blocks only the backend\'s own starter migrations', () => {
  const ms = [
    migration('002_two.sql', [T('fa'), T('fb')], 'frontend'),
    migration('002_crm_core.sql', [T('pipelines'), T('crm_tags')]),
    migration('003_schema_migrations.sql', [T('schema_migrations')]),
    migration('900_member.sql', [T('ma'), T('mb')]),
  ];
  const tables = (...names) => catalogFromRows({ tables: names.map((table_name) => ({ table_name })) });
  const target = new Set(['002_crm_core.sql', '003_schema_migrations.sql']);

  // Frontend and member partials: warnings only; 002 and 003 pending, the history table first.
  let p = planMigrations(computeStatus(ms, null, tables('fa', 'ma')), target);
  assert.deepEqual(p.blocking, []);
  assert.equal(p.warnings.length, 2);
  assert.match(p.warnings[0].message, /frontend\/002_two\.sql is partly applied/);
  assert.match(p.warnings[1].message, /backend\/900_member\.sql is partly applied/);
  assert.deepEqual(p.toApply.map((s) => s.name), ['003_schema_migrations.sql', '002_crm_core.sql']);

  // The backend's own 002 partly there: blocks.
  p = planMigrations(computeStatus(ms, null, tables('pipelines')), target);
  assert.deepEqual(p.blocking.map((s) => s.name), ['002_crm_core.sql']);

  // An earlier release's migration still pending is applied even though the target did not add it.
  p = planMigrations(computeStatus(ms, [{ repo: 'backend', name: '003_schema_migrations.sql', checksum: ms[2].checksum }], tables('schema_migrations')), target);
  assert.deepEqual(p.toApply.map((s) => s.name), ['002_crm_core.sql']);
  assert.deepEqual(p.notOurs.map((s) => s.name), ['002_two.sql', '900_member.sql']);
});

test('planMigrations flags a starter migration edited after it was applied', () => {
  const m = migration('001_backend_core.sql', [T('backend_settings')]);
  const states = computeStatus([m], [{ repo: 'backend', name: m.name, checksum: 'sha256:' + '0'.repeat(64) }], catalogFromRows({}));
  const p = planMigrations(states, new Set([m.name]));
  assert.equal(p.warnings.length, 1);
  assert.match(p.warnings[0].message, /edited after it was applied/);
  assert.deepEqual(p.toApply, []);
});

test('seed rows: every inferred migration and nothing else', () => {
  const ms = [
    migration('001_visitors.sql', [T('visitors')], 'frontend'),
    migration('001_backend_core.sql', [T('backend_settings')]),
    migration('002_crm_core.sql', [T('pipelines')]),
  ];
  const states = computeStatus(ms, null, catalogFromRows({ tables: [{ table_name: 'visitors' }, { table_name: 'backend_settings' }] }));
  const byKey = new Map(ms.map((m) => [`${m.repo}/${m.name}`, m]));
  assert.deepEqual(seedRows(states, byKey, '2026-10-26'), [
    { name: '001_visitors.sql', repo: 'frontend', checksum: ms[0].checksum, applied_by: 'seed:2026-10-26' },
    { name: '001_backend_core.sql', repo: 'backend', checksum: ms[1].checksum, applied_by: 'seed:2026-10-26' },
  ]);
});

test('classifyDiff sorts name-status lines into added, modified and deleted', () => {
  const fake = [
    'A\tsupabase/migrations/003_schema_migrations.sql',
    'A\tsrc/app/api/home/route.ts',
    'M\tsrc/components/sidebar.tsx',
    'M\tVERSION',
    'T\tscripts/deploy.sh',
    'D\tscripts/old.mjs',
    'R100\tsrc/lib/a.ts\tsrc/lib/b.ts',
    '',
  ].join('\r\n');
  assert.deepEqual(classifyDiff(fake), {
    added: ['supabase/migrations/003_schema_migrations.sql', 'src/app/api/home/route.ts', 'src/lib/b.ts'],
    modified: ['src/components/sidebar.tsx', 'VERSION', 'scripts/deploy.sh'],
    deleted: ['scripts/old.mjs', 'src/lib/a.ts'],
  });
});

test('planFiles: new files are taken, customised files are merged, nothing is deleted', () => {
  const trees = {
    HEAD: {
      'src/types/database.ts': 'old', 'src/components/sidebar.tsx': 'mine', 'src/lib/x.ts': 'old',
      'CHANGELOG.md': 'new', 'scripts/upgrade.mjs': 'new', 'brand/playbook.json': 'member', 'scripts/old.mjs': 'old',
      VERSION: '2.9.0',
    },
    'v2.9.0': {
      'src/types/database.ts': 'old', 'src/components/sidebar.tsx': 'old', 'src/lib/x.ts': 'old',
      'src/lib/y.ts': 'old', 'CHANGELOG.md': 'old', 'scripts/old.mjs': 'old', VERSION: '2.9.0',
    },
    'v3.0.0': {
      'src/types/database.ts': 'new', 'src/components/sidebar.tsx': 'new', 'src/lib/x.ts': 'new', 'src/lib/y.ts': 'new',
      'CHANGELOG.md': 'new', 'scripts/upgrade.mjs': 'new', 'brand/playbook.json': 'empty',
      'src/app/api/home/route.ts': 'new', VERSION: '3.0.0',
    },
  };
  const blob = (ref, path) => trees[ref][path] ?? null;
  const diff = {
    added: ['src/app/api/home/route.ts', 'scripts/upgrade.mjs', 'brand/playbook.json'],
    modified: ['src/lib/x.ts', 'src/components/sidebar.tsx', 'src/types/database.ts', 'CHANGELOG.md', 'src/lib/y.ts', 'VERSION'],
    deleted: ['scripts/old.mjs', 'scripts/gone-here-too.mjs'],
  };
  assert.deepEqual(planFiles(diff, blob, { current: 'v2.9.0', target: 'v3.0.0' }), {
    checkout: ['src/app/api/home/route.ts'],
    present: ['scripts/upgrade.mjs'],
    conflict: ['brand/playbook.json'],
    merge: ['src/components/sidebar.tsx'],
    untouched: ['src/types/database.ts', 'src/lib/x.ts'],
    current: ['CHANGELOG.md'],
    removedHere: ['src/lib/y.ts'],
    deletedUpstream: ['scripts/old.mjs'],
  });
});

test('releaseTags: newest first, numeric order, no pre-releases', () => {
  assert.deepEqual(releaseTags('v2.9.0\nv2.10.0\nv2.9.0-beta.1\nv3.0.0\nnot-a-tag\nv2.5.11\n'), ['v3.0.0', 'v2.10.0', 'v2.9.0', 'v2.5.11']);
});

test('writeGate: the ref must be said back exactly, and --yes given', () => {
  assert.match(writeGate({ envRef: null, projectRef: 'abc', yes: true }), /Could not read/);
  assert.match(writeGate({ envRef: 'abc', projectRef: undefined, yes: true }), /--project-ref abc --yes/);
  assert.match(writeGate({ envRef: 'abc', projectRef: true, yes: true }), /--project-ref abc --yes/);
  assert.match(writeGate({ envRef: 'abc', projectRef: 'abd', yes: true }), /does not match/);
  assert.match(writeGate({ envRef: 'abc', projectRef: 'abc', yes: undefined }), /--yes/);
  assert.equal(writeGate({ envRef: 'abc', projectRef: 'abc', yes: true }), null);
});

test('parseArgs takes values for the named flags only', () => {
  assert.deepEqual(parseArgs(['--project-ref', 'abc', '--yes', '--to=v3.0.0', 'x'], ['project-ref', 'to']), {
    _: ['x'], 'project-ref': 'abc', yes: true, to: 'v3.0.0',
  });
  assert.throws(() => parseArgs(['--project-ref', '--yes'], ['project-ref']), /needs a value/);
});

test('.env.local: CRLF, quotes and export; repo root first, then the main checkout', () => {
  const main = tmp('main-checkout');
  const worktree = tmp('worktree');
  writeFileSync(join(main, '.env.local'), 'export SUPABASE_URL="https://abcdefgh.supabase.co"\r\nAPI_SECRET_KEY=\'s\'\r\n# comment\r\n');
  const env = readEnvFile(join(main, '.env.local'));
  assert.equal(env.API_SECRET_KEY, 's');
  assert.equal(projectRefFromEnv(env), 'abcdefgh');
  assert.equal(projectRefFromEnv({ NEXT_PUBLIC_SUPABASE_URL: 'https://zz.supabase.co' }), 'zz');
  assert.equal(projectRefFromEnv({}), null);

  let loaded = loadEnv([worktree, main]);
  assert.equal(loaded.ref, 'abcdefgh');
  assert.equal(loaded.path, join(main, '.env.local'));
  writeFileSync(join(worktree, '.env.local'), 'SUPABASE_URL=https://wtref.supabase.co\n');
  assert.equal(loadEnv([worktree, main]).ref, 'wtref');
  loaded = loadEnv([tmp('empty-a'), tmp('empty-b')]);
  assert.equal(loaded.ref, null);
  assert.match(describeEnv(loaded), /no \.env\.local at .*empty-a\/\.env\.local or .*empty-b\/\.env\.local/);
});

test('frontendCandidates look beside the backend and the main checkout', () => {
  const c = frontendCandidates(['/w/acme-backend', '/home/digital-home-backend-starter']);
  assert.equal(c[0], '/w/acme-frontend');
  assert.ok(c.includes('/w/digital-home-frontend'));
  assert.ok(c.includes('/home/digital-home-frontend-starter'));
  assert.match(findFrontend('/nonexistent/frontend', []).notice, /not a frontend checkout/);
});

test('migration 003 creates the history table, keyed by (repo, name), service role only', () => {
  const sql = readFileSync(join(ROOT, 'supabase', 'migrations', '003_schema_migrations.sql'), 'utf8');
  assert.deepEqual(labels(extractMarkers(sql)), ['table schema_migrations']);
  assert.match(sql, /primary key \(repo, name\)/);
  assert.match(sql, /check \(repo in \('frontend', 'backend'\)\)/);
  assert.match(sql, /applied_at timestamptz not null default now\(\)/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table schema_migrations from anon, authenticated/);
  assert.doesNotMatch(sql, /create policy/);
  const db = readFileSync(join(ROOT, 'scripts', 'lib', 'db.mjs'), 'utf8');
  assert.match(db, /on conflict \(repo, name\) do nothing returning name/);
  assert.match(db, /rejectUnauthorized: true/);
  assert.doesNotMatch(db, /rejectUnauthorized: false/);
  assert.match(db, /set lock_timeout/);
  assert.match(db, /set statement_timeout/);
});

// ── The scripts, against a fake database ─────────────────────────────────────

const FAKE_DB = `// Test double for scripts/lib/db.mjs: state from $FAKE_DB, every call logged to $FAKE_DB_LOG.
import { appendFileSync, readFileSync } from 'node:fs';
import { catalogFromRows } from './migrations.mjs';
const state = JSON.parse(readFileSync(process.env.FAKE_DB, 'utf8'));
const log = (e) => appendFileSync(process.env.FAKE_DB_LOG, JSON.stringify(e) + '\\n');
export const TIMEOUTS = { lock: 5, statement: 60 };
export const explainError = (e) => e.message;
export async function connect(ref) { log({ op: 'connect', ref }); return { end: async () => {} }; }
export async function readState() { log({ op: 'readState' }); return { history: state.history ?? null, catalog: catalogFromRows(state) }; }
export async function applyAndRecord(client, m, appliedBy, record = true) { log({ op: 'apply', repo: m.repo, name: m.name, appliedBy, record }); }
export async function seedHistory(client, { createSql, rows }) {
  const taken = new Set(state.alreadyRecorded ?? []);
  log({ op: 'seed', created: Boolean(createSql), rows: rows.map((r) => r.repo + '/' + r.name) });
  return { inserted: rows.filter((r) => !taken.has(r.repo + '/' + r.name)), existing: rows.filter((r) => taken.has(r.repo + '/' + r.name)) };
}
`;

const TOOL_FILES = ['upgrade.mjs', 'migrations-status.mjs', 'migrations-seed.mjs'];
const gitConfig = join(TMP, 'gitconfig');
writeFileSync(gitConfig, '[user]\n\tname = Test\n\temail = test@example.com\n[init]\n\tdefaultBranch = main\n[advice]\n\tdetachedHead = false\n');
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1' };
delete GIT_ENV.SUPABASE_DB_PASSWORD;

function sh(cwd, ...gitArgs) {
  const r = spawnSync('git', gitArgs, { cwd, env: GIT_ENV, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${gitArgs.join(' ')}: ${r.stderr}`);
  return r.stdout;
}
function write(dir, path, content) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
}
/** The real tools, with the fake database module in place of lib/db.mjs. */
function installTools(dir) {
  for (const f of TOOL_FILES) cpSync(join(ROOT, 'scripts', f), join(dir, 'scripts', f));
  cpSync(join(ROOT, 'scripts', 'lib'), join(dir, 'scripts', 'lib'), { recursive: true });
  cpSync(join(ROOT, 'scripts', 'certs'), join(dir, 'scripts', 'certs'), { recursive: true });
  writeFileSync(join(dir, 'scripts', 'lib', 'db.mjs'), FAKE_DB);
}
function runScript(dir, script, argv, { db, password = 'fake-password', extraEnv = {} } = {}) {
  const logPath = join(dir, '..', `db-log-${++n}.jsonl`);
  writeFileSync(logPath, '');
  const statePath = join(dir, '..', `db-state-${n}.json`);
  writeFileSync(statePath, JSON.stringify(db ?? {}));
  const env = { ...GIT_ENV, FAKE_DB: statePath, FAKE_DB_LOG: logPath, ...extraEnv };
  if (password) env.SUPABASE_DB_PASSWORD = password;
  const r = spawnSync(process.execPath, [join(dir, 'scripts', script), ...argv], { cwd: dir, env, encoding: 'utf8', timeout: 30000, input: '' });
  const calls = readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.doesNotMatch(r.stdout + r.stderr, /fake-password/, 'the password is never printed');
  return { ...r, calls, out: r.stdout + r.stderr };
}

const BACKEND_001 = readFileSync(join(ROOT, 'supabase', 'migrations', '001_backend_core.sql'), 'utf8');
const BACKEND_002 = readFileSync(join(ROOT, 'supabase', 'migrations', '002_crm_core.sql'), 'utf8');
const BACKEND_003 = readFileSync(join(ROOT, 'supabase', 'migrations', '003_schema_migrations.sql'), 'utf8');
const CRM_TABLES = KNOWN_MARKERS.backend['002_crm_core.sql'].map((m) => m.name);
const rows = (...names) => names.map((table_name) => ({ table_name }));
/** A 2.9.0 Home's database: 001 and 002 there, no history. */
const HOME_29 = { history: null, tables: rows('visitors', 'backend_settings', 'brand_context', ...CRM_TABLES) };

/**
 * A fake starter with v2.9.0 and an annotated v3.0.0 that adds the tools,
 * migration 003 and a file, and changes the sidebar and the types; and a Home
 * cloned at v2.9.0 with its own sidebar, the v3.0.0 tools brought in on
 * upgrade/v3.0.0 as UPGRADE.md says, and a frontend checkout beside it.
 */
function fixture() {
  const base = tmp('fixture');
  const starter = join(base, 'starter');
  mkdirSync(starter);
  sh(starter, 'init', '-q');
  write(starter, '.gitignore', '.env.local\n');
  write(starter, 'src/app/api/write-article/route.ts', 'export {};\n');
  write(starter, 'src/components/sidebar.tsx', 'sidebar v1\n');
  write(starter, 'src/types/database.ts', 'types v1\n');
  write(starter, 'supabase/migrations/001_backend_core.sql', BACKEND_001);
  write(starter, 'supabase/migrations/002_crm_core.sql', BACKEND_002);
  write(starter, 'VERSION', '2.9.0\n');
  sh(starter, 'add', '.gitignore', 'VERSION', 'src', 'supabase');
  sh(starter, 'commit', '-qm', 'v2.9.0');
  sh(starter, 'tag', 'v2.9.0');
  installTools(starter);
  write(starter, 'supabase/migrations/003_schema_migrations.sql', BACKEND_003);
  write(starter, 'src/lib/new-in-3.ts', 'export const x = 3;\n');
  write(starter, 'src/components/sidebar.tsx', 'sidebar v2\n');
  write(starter, 'src/types/database.ts', 'types v2\n');
  write(starter, 'VERSION', '3.0.0\n');
  sh(starter, 'add', 'VERSION', 'src', 'supabase', 'scripts');
  sh(starter, 'commit', '-qm', 'v3.0.0');
  sh(starter, 'tag', '-a', '-m', 'v3.0.0', 'v3.0.0');

  const home = join(base, 'home');
  sh(base, 'clone', '-q', starter, home);
  sh(home, 'checkout', '-q', '-B', 'main', 'v2.9.0');
  sh(home, 'remote', 'remove', 'origin');
  write(home, 'src/components/sidebar.tsx', 'sidebar v1, the member\'s own\n');
  sh(home, 'commit', '-qam', 'member sidebar');
  write(home, '.env.local', 'SUPABASE_URL=https://homeref.supabase.co\n');
  sh(home, 'checkout', '-q', '-b', 'upgrade/v3.0.0');
  sh(home, 'checkout', 'v3.0.0', '--', 'scripts/upgrade.mjs', 'scripts/lib', 'scripts/certs', 'scripts/migrations-status.mjs', 'scripts/migrations-seed.mjs', 'supabase/migrations/003_schema_migrations.sql');
  sh(home, 'commit', '-qm', 'Bring in the upgrade tools from v3.0.0');

  const frontend = join(base, 'frontend');
  mkdirSync(frontend);
  sh(frontend, 'init', '-q');
  write(frontend, 'supabase/migrations/001_visitors.sql', 'create table visitors (id uuid);\n');
  write(frontend, 'src/types/database.ts', 'types v0\n');
  sh(frontend, 'add', 'src/types/database.ts', 'supabase/migrations/001_visitors.sql');
  sh(frontend, 'commit', '-qm', 'frontend');
  return { base, starter, home, frontend };
}

function snapshot(dir) {
  return {
    refs: sh(dir, 'for-each-ref', '--format=%(refname) %(objectname)'),
    head: sh(dir, 'rev-parse', 'HEAD'),
    branch: sh(dir, 'branch', '--show-current'),
    status: sh(dir, 'status', '--porcelain'),
    remotes: sh(dir, 'remote', '-v'),
    fetchHead: existsSync(join(dir, '.git', 'FETCH_HEAD')),
    version: readFileSync(join(dir, 'VERSION'), 'utf8'),
  };
}

describe('upgrade.mjs against a fake starter and database', () => {
  test('refuses an unexpected starter remote without touching files or database', () => {
    const f = fixture();
    sh(f.home, 'remote', 'add', 'starter', f.starter);
    const before = snapshot(f.home);
    const r = runScript(f.home, 'upgrade.mjs', ['--no-fetch'], { db: HOME_29 });
    assert.equal(r.status, 1);
    assert.match(r.out, /Starter remote differs/);
    assert.deepEqual(snapshot(f.home), before);
    assert.ok(!r.calls.some(c => c.op === 'apply'));
  });
  test('refuses a target tag whose VERSION disagrees before creating an upgrade', () => {
    const f = fixture();
    sh(f.home, 'tag', 'v3.1.0', 'v3.0.0^{}');
    const before = snapshot(f.home);
    const r = runScript(f.home, 'upgrade.mjs', ['--dry-run', '--no-fetch', '--to', 'v3.1.0', '--starter-url', f.starter], { db: HOME_29 });
    assert.equal(r.status, 1);
    assert.match(r.out, /does not match its tag/);
    assert.deepEqual(snapshot(f.home), before);
  });

  test('--dry-run writes no ref, file, branch or database change, even with --yes', () => {
    const f = fixture();
    sh(f.home, 'tag', '-d', 'v3.0.0'); // so the dry run has to discover the target remotely
    const before = snapshot(f.home);
    const r = runScript(f.home, 'upgrade.mjs', ['--dry-run', '--starter-url', f.starter, '--frontend', f.frontend, '--project-ref', 'homeref', '--yes', '--take-untouched'], { db: HOME_29 });
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(snapshot(f.home), before);
    assert.match(r.out, /git ls-remote --tags/);
    assert.match(r.out, /\[dry-run\] would run: git remote add starter/);
    assert.match(r.out, /\[dry-run\] would apply 1 migration\(s\) to homeref/);
    assert.match(r.out, /is on main; not copying/);
    assert.deepEqual(r.calls.map((c) => c.op), ['connect', 'readState']);
    assert.equal(readFileSync(join(f.frontend, 'src/types/database.ts'), 'utf8'), 'types v0\n');
  });

  test('stops at the database gate without --project-ref and --yes, then resumes and applies in order', () => {
    const f = fixture();
    let r = runScript(f.home, 'upgrade.mjs', ['--starter-url', f.starter], { db: HOME_29 });
    assert.equal(r.status, 2, r.out);
    assert.match(r.out, /This will write to Supabase project "homeref"/);
    assert.match(r.out, /node scripts\/upgrade\.mjs --to v3\.0\.0 --project-ref homeref --yes/);
    assert.ok(!r.calls.some((c) => c.op === 'apply'));
    assert.equal(readFileSync(join(f.home, 'VERSION'), 'utf8'), '2.9.0\n');
    assert.ok(existsSync(join(f.home, 'src/lib/new-in-3.ts')), 'new files are checked out and committed');
    assert.equal(sh(f.home, 'status', '--porcelain'), '');
    assert.match(r.out, /src\/components\/sidebar\.tsx\n\s+what the starter changed: git diff v2\.9\.0 v3\.0\.0 -- src\/components\/sidebar\.tsx/);

    r = runScript(f.home, 'upgrade.mjs', ['--starter-url', f.starter, '--project-ref', 'otherref', '--yes'], { db: HOME_29 });
    assert.equal(r.status, 2, r.out);
    assert.match(r.out, /does not match/);
    assert.ok(!r.calls.some((c) => c.op === 'apply'));

    // 002 is pending too (from an earlier release, not added by v3.0.0): both apply, in order.
    const db = { history: null, tables: rows('visitors', 'backend_settings', 'brand_context') };
    sh(f.frontend, 'checkout', '-q', '-b', 'upgrade/v3.0.0');
    r = runScript(f.home, 'upgrade.mjs', ['--starter-url', f.starter, '--project-ref', 'homeref', '--yes', '--frontend', f.frontend, '--take-untouched'], { db });
    assert.equal(r.status, 0, r.out);
    // The history table first, so 002 is recorded too.
    assert.deepEqual(r.calls.filter((c) => c.op === 'apply'), [
      { op: 'apply', repo: 'backend', name: '003_schema_migrations.sql', appliedBy: 'upgrade:v3.0.0', record: true },
      { op: 'apply', repo: 'backend', name: '002_crm_core.sql', appliedBy: 'upgrade:v3.0.0', record: true },
    ]);
    assert.match(r.out, /Record them once:\n\s+node scripts\/migrations-seed\.mjs --project-ref homeref --yes/);
    assert.equal(readFileSync(join(f.home, 'VERSION'), 'utf8'), '2.9.0\n', 'preparation must not report a completed upgrade');
    assert.equal(readFileSync(join(f.frontend, 'src/types/database.ts'), 'utf8'), 'types v2\n');
    assert.match(r.out, /git -C .* add src\/types\/database\.ts && git -C .* commit/);
  });

  test('a partial frontend or member migration warns; a partial starter backend one refuses', () => {
    const f = fixture();
    write(f.home, 'supabase/migrations/900_member.sql', 'create table ma (id int);\ncreate table mb (id int);\n');
    sh(f.home, 'add', 'supabase/migrations/900_member.sql');
    sh(f.home, 'commit', '-qm', 'member migration');
    let r = runScript(f.home, 'upgrade.mjs', ['--starter-url', f.starter, '--project-ref', 'homeref', '--yes'], { db: { ...HOME_29, tables: [...HOME_29.tables, ...rows('ma')] } });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /Warning: backend\/900_member\.sql is partly applied/);
    assert.deepEqual(r.calls.filter((c) => c.op === 'apply').map((c) => c.name), ['003_schema_migrations.sql']);

    const g = fixture();
    r = runScript(g.home, 'upgrade.mjs', ['--starter-url', g.starter, '--project-ref', 'homeref', '--yes'], { db: { history: null, tables: rows('backend_settings', 'brand_context', 'pipelines') } });
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /backend\/002_crm_core\.sql: missing table crm_custom_fields/);
    assert.match(r.out, /Partly applied migrations/);
    assert.ok(!r.calls.some((c) => c.op === 'apply'));
    assert.equal(readFileSync(join(g.home, 'VERSION'), 'utf8'), '2.9.0\n');
  });

  test('refuses to run with a different copy of the tools than the target carries', () => {
    const f = fixture();
    write(f.home, 'scripts/lib/migrations.mjs', readFileSync(join(f.home, 'scripts/lib/migrations.mjs'), 'utf8') + '\n// older\n');
    sh(f.home, 'commit', '-qam', 'older tools');
    const r = runScript(f.home, 'upgrade.mjs', ['--starter-url', f.starter], { db: HOME_29 });
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /different copy of the upgrade tools/);
    // Already on upgrade/v3.0.0, so the printed commands start with the checkout of the tools.
    const commands = r.out.slice(r.out.indexOf('then run it:')).split('\n').slice(1, 4).map((l) => l.trim());
    assert.deepEqual(commands, [
      'git checkout v3.0.0 -- scripts/lib/migrations.mjs',
      'git commit -m "Bring in the upgrade tools from v3.0.0"',
      'node scripts/upgrade.mjs --to v3.0.0',
    ]);
    assert.ok(!r.calls.length);
  });

  test('a real run that makes the branch prints no checkout -b for stale tools; a dry run does', () => {
    const f = fixture();
    sh(f.home, 'checkout', '-q', 'main');
    sh(f.home, 'branch', '-q', '-D', 'upgrade/v3.0.0'); // start before the fixture's bootstrap
    // main has the member's sidebar and no v3.0.0 tools: these are the older tools of the Home.
    installTools(f.home);
    write(f.home, 'scripts/lib/migrations.mjs', readFileSync(join(f.home, 'scripts/lib/migrations.mjs'), 'utf8') + '\n// older\n');
    sh(f.home, 'add', 'scripts');
    sh(f.home, 'commit', '-qm', 'older tools on main');
    let r = runScript(f.home, 'upgrade.mjs', ['--dry-run', '--starter-url', f.starter], { db: HOME_29 });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /then run it:\n\s+git checkout -b upgrade\/v3\.0\.0\n\s+git checkout v3\.0\.0 -- scripts\/lib\/migrations\.mjs/);
    r = runScript(f.home, 'upgrade.mjs', ['--starter-url', f.starter], { db: HOME_29 });
    assert.equal(r.status, 1, r.out);
    assert.equal(sh(f.home, 'branch', '--show-current').trim(), 'upgrade/v3.0.0');
    assert.match(r.out, /then run it:\n\s+git checkout v3\.0\.0 -- scripts\/lib\/migrations\.mjs\n/);
    assert.doesNotMatch(r.out, /then run it:\n\s+git checkout -b/);
  });

  test('never copies the types over uncommitted work in the frontend', () => {
    const f = fixture();
    sh(f.frontend, 'checkout', '-q', '-b', 'upgrade/v3.0.0');
    write(f.frontend, 'src/types/database.ts', 'types v0 with a local edit\n');
    const r = runScript(f.home, 'upgrade.mjs', ['--starter-url', f.starter, '--project-ref', 'homeref', '--yes', '--frontend', f.frontend, '--take-untouched'], { db: HOME_29 });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /has uncommitted changes; not copying over them/);
    assert.equal(readFileSync(join(f.frontend, 'src/types/database.ts'), 'utf8'), 'types v0 with a local edit\n');
    assert.equal(readFileSync(join(f.home, 'src/types/database.ts'), 'utf8'), 'types v2\n');
  });

  test('without a password it stops before the database, and never takes one from argv', () => {
    const f = fixture();
    const r = runScript(f.home, 'upgrade.mjs', ['--starter-url', f.starter, '--password', 'fake-password'], { db: HOME_29, password: null });
    assert.equal(r.status, 2, r.out);
    assert.match(r.out, /No database password\. Set SUPABASE_DB_PASSWORD/);
    assert.ok(!r.calls.length);
  });

  test('refuses a folder that is not a backend fork', () => {
    const dir = tmp('not-backend');
    installTools(dir);
    const r = runScript(dir, 'upgrade.mjs', ['--dry-run']);
    assert.equal(r.status, 1);
    assert.match(r.out, /not a Digital Home backend/);
  });
});

describe('migrations-seed.mjs against a fake database', () => {
  function seedDir(envRef = 'homeref') {
    const dir = tmp('seed');
    installTools(dir);
    cpSync(join(ROOT, 'supabase', 'migrations'), join(dir, 'supabase', 'migrations'), { recursive: true });
    if (envRef) writeFileSync(join(dir, '.env.local'), `SUPABASE_URL=https://${envRef}.supabase.co\n`);
    return dir;
  }

  test('stops before connecting without --project-ref, on a mismatched one, or with no database named', () => {
    const dir = seedDir();
    let r = runScript(dir, 'migrations-seed.mjs', [], { db: HOME_29 });
    assert.equal(r.status, 2, r.out);
    assert.match(r.out, /Supabase project homeref \(from .*\.env\.local\)/);
    assert.match(r.out, /--project-ref homeref --yes/);
    assert.deepEqual(r.calls, []);
    r = runScript(dir, 'migrations-seed.mjs', ['--project-ref', 'otherref', '--yes'], { db: HOME_29 });
    assert.equal(r.status, 2);
    assert.match(r.out, /does not match/);
    assert.deepEqual(r.calls, []);
    r = runScript(seedDir(null), 'migrations-seed.mjs', ['--project-ref', 'homeref', '--yes'], { db: HOME_29 });
    assert.equal(r.status, 2);
    assert.match(r.out, /no \.env\.local at/);
    assert.deepEqual(r.calls, []);
  });

  test('prints the rows and stops without --yes; --dry-run never writes, even with --yes', () => {
    const dir = seedDir();
    let r = runScript(dir, 'migrations-seed.mjs', ['--project-ref', 'homeref'], { db: HOME_29 });
    assert.equal(r.status, 2, r.out);
    assert.match(r.out, /Will create schema_migrations/);
    assert.match(r.out, /backend\s+001_backend_core\.sql/);
    assert.match(r.out, /Re-run with --yes/);
    assert.deepEqual(r.calls.map((c) => c.op), ['connect', 'readState']);
    r = runScript(dir, 'migrations-seed.mjs', ['--project-ref', 'homeref', '--yes', '--dry-run'], { db: HOME_29 });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /Dry run: 3 row\(s\) would be written to homeref\. Nothing was written\./);
    assert.ok(!r.calls.some((c) => c.op === 'seed'));
  });

  test('--yes writes in one transaction and reports rows that were already there', () => {
    const dir = seedDir();
    const r = runScript(dir, 'migrations-seed.mjs', ['--project-ref', 'homeref', '--yes'], { db: { ...HOME_29, alreadyRecorded: ['backend/002_crm_core.sql'] } });
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(r.calls.find((c) => c.op === 'seed'), {
      op: 'seed', created: true, rows: ['backend/001_backend_core.sql', 'backend/002_crm_core.sql', 'backend/003_schema_migrations.sql'],
    });
    assert.match(r.out, /Recorded 2 migrations in homeref\./);
    assert.match(r.out, /Already recorded, left unchanged .*: backend\/002_crm_core\.sql/);
  });
});

test('migrations-status.mjs needs a password and never reads one from argv', () => {
  const dir = tmp('status');
  installTools(dir);
  writeFileSync(join(dir, '.env.local'), 'SUPABASE_URL=https://homeref.supabase.co\n');
  let r = runScript(dir, 'migrations-status.mjs', ['--json', '--password', 'fake-password'], { db: HOME_29, password: null });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /No database password/);
  assert.deepEqual(r.calls, []);
  r = runScript(dir, 'migrations-status.mjs', ['--json'], { db: HOME_29 });
  assert.equal(r.status, 0, r.out);
  const report = JSON.parse(r.stdout);
  assert.equal(report.projectRef, 'homeref');
  assert.equal(report.historyTable, false);
});

test('apply-migration.mjs refuses a mismatched --project-ref and a missing password, applies through the shared module', () => {
  const dir = tmp('apply');
  installTools(dir);
  cpSync(join(ROOT, 'scripts', 'apply-migration.mjs'), join(dir, 'scripts', 'apply-migration.mjs'));
  writeFileSync(join(dir, '.env.local'), 'SUPABASE_URL=https://homeref.supabase.co\n');
  writeFileSync(join(dir, 'fix.sql'), 'create table if not exists crm_tags (id int);\n');
  let r = runScript(dir, 'apply-migration.mjs', ['fix.sql', '--project-ref', 'otherref'], { db: HOME_29 });
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /does not match/);
  assert.deepEqual(r.calls, []);
  r = runScript(dir, 'apply-migration.mjs', ['fix.sql'], { db: HOME_29, password: null });
  assert.equal(r.status, 1);
  assert.match(r.out, /No database password/);
  assert.deepEqual(r.calls, []);
  r = runScript(dir, 'apply-migration.mjs', ['fix.sql', '--project-ref', 'homeref'], { db: HOME_29 });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /Database: Supabase project homeref/);
  assert.deepEqual(r.calls.filter((c) => c.op === 'apply'), [{ op: 'apply', repo: 'backend', name: 'fix.sql', appliedBy: null, record: false }]);
});
