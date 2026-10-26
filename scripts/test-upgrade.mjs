// Tests for the migration history and upgrade tools. No database: the pure
// parts are tested directly, and the scripts' confirmation gates are run in a
// throwaway folder where they must stop before connecting.
//   node --test scripts/test-upgrade.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { projectRefFromEnv, readEnvFile } from './lib/db.mjs';
import { backendRoots } from './lib/context.mjs';
import {
  KNOWN_MARKERS,
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
  releaseTags,
  seedRows,
  summarise,
  writeGate,
} from './lib/migrations.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const labels = (markers) => markers.map(markerLabel).sort();

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

test('KNOWN_MARKERS match the frontend files, when a frontend checkout is next door', (t) => {
  const frontend = findFrontend(null, backendRoots(ROOT));
  if (!frontend.path) return t.skip(frontend.notice);
  const files = listMigrations(join(frontend.path, 'supabase', 'migrations'), 'frontend');
  assert.deepEqual(files.map((f) => f.name).slice(0, 11), Object.keys(KNOWN_MARKERS.frontend));
  for (const f of files.filter((f) => KNOWN_MARKERS.frontend[f.name])) {
    const extracted = extractMarkers(f.sql);
    const tables = extracted.filter((m) => m.kind === 'table');
    // 011 creates no table: its policies stand in.
    const expected = tables.length ? tables : extracted.filter((m) => m.kind === 'policy');
    assert.deepEqual(labels(KNOWN_MARKERS.frontend[f.name]), labels(expected), f.name);
  }
});

const migration = (name, markers, repo = 'backend', sql = `-- ${name}`) => ({
  name, repo, sql, checksum: checksum(sql), markers, starterOwned: Number(name.slice(0, 3)) < 900,
});

test('status: applied, inferred, partial and pending', () => {
  const ms = [
    migration('001_a.sql', [{ kind: 'table', name: 'a' }]),
    migration('002_b.sql', [{ kind: 'table', name: 'b' }, { kind: 'column', table: 'leads', name: 'phone' }]),
    migration('003_c.sql', [{ kind: 'table', name: 'c' }, { kind: 'table', name: 'c2' }]),
    migration('004_d.sql', [{ kind: 'table', name: 'd' }]),
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

test('status: with no history table, a record never comes from the other repo', () => {
  const ms = [migration('001_a.sql', [{ kind: 'table', name: 'a' }], 'frontend')];
  const catalog = catalogFromRows({ tables: [{ table_name: 'a' }] });
  assert.equal(computeStatus(ms, null, catalog)[0].status, 'inferred');
  const other = [{ name: '001_a.sql', repo: 'backend', checksum: null }];
  assert.equal(computeStatus(ms, other, catalog)[0].status, 'inferred');
});

test('seed rows: every inferred migration and nothing else', () => {
  const ms = [
    migration('001_visitors.sql', [{ kind: 'table', name: 'visitors' }], 'frontend'),
    migration('001_backend_core.sql', [{ kind: 'table', name: 'backend_settings' }]),
    migration('002_crm_core.sql', [{ kind: 'table', name: 'pipelines' }]),
  ];
  const catalog = catalogFromRows({ tables: [{ table_name: 'visitors' }, { table_name: 'backend_settings' }] });
  const states = computeStatus(ms, null, catalog);
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

test('readEnvFile handles CRLF, quotes and export, as Windows checkouts write them', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dh-env-'));
  try {
    const path = join(dir, '.env.local');
    writeFileSync(path, 'export SUPABASE_URL="https://abcdefgh.supabase.co"\r\nAPI_SECRET_KEY=\'s\'\r\n# comment\r\n');
    const env = readEnvFile(path);
    assert.equal(env.SUPABASE_URL, 'https://abcdefgh.supabase.co');
    assert.equal(env.API_SECRET_KEY, 's');
    assert.equal(projectRefFromEnv(env), 'abcdefgh');
    assert.equal(projectRefFromEnv({ NEXT_PUBLIC_SUPABASE_URL: 'https://zz.supabase.co' }), 'zz');
    assert.equal(projectRefFromEnv({}), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('frontendCandidates look beside the backend and the main checkout', () => {
  const c = frontendCandidates(['/w/acme-backend', '/home/digital-home-backend-starter']);
  assert.equal(c[0], '/w/acme-frontend');
  assert.ok(c.includes('/w/digital-home-frontend'));
  assert.ok(c.includes('/home/digital-home-frontend-starter'));
  assert.match(findFrontend('/nonexistent/frontend', []).notice, /not a frontend checkout/);
});

// ── The gates, run as the scripts themselves ─────────────────────────────────

function sandbox(envRef) {
  const dir = mkdtempSync(join(tmpdir(), 'dh-gate-'));
  cpSync(join(ROOT, 'scripts', 'lib'), join(dir, 'scripts', 'lib'), { recursive: true });
  for (const f of ['migrations-seed.mjs', 'migrations-status.mjs', 'upgrade.mjs']) cpSync(join(ROOT, 'scripts', f), join(dir, 'scripts', f));
  cpSync(join(ROOT, 'supabase', 'migrations'), join(dir, 'supabase', 'migrations'), { recursive: true });
  if (envRef) writeFileSync(join(dir, '.env.local'), `SUPABASE_URL=https://${envRef}.supabase.co\n`);
  return dir;
}

function run(dir, script, argv) {
  const env = { ...process.env };
  delete env.SUPABASE_DB_PASSWORD;
  return spawnSync(process.execPath, [join(dir, 'scripts', script), ...argv], { cwd: dir, env, encoding: 'utf8', timeout: 20000 });
}

test('seed: stops at the gate without --project-ref, and on a mismatched one, before connecting', () => {
  const dir = sandbox('homeref123');
  try {
    let r = run(dir, 'migrations-seed.mjs', []);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stdout, /Supabase project homeref123/);
    assert.match(r.stdout, /--project-ref homeref123 --yes/);
    assert.doesNotMatch(r.stdout, /Connected|pooler/);

    r = run(dir, 'migrations-seed.mjs', ['--project-ref', 'otherref', '--yes']);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stdout, /does not match/);
    assert.doesNotMatch(r.stdout, /Connected|pooler/);

    // A matching ref passes the first gate and only then needs the password.
    r = run(dir, 'migrations-seed.mjs', ['--project-ref', 'homeref123']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /SUPABASE_DB_PASSWORD not set/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('seed: refuses when .env.local names no database', () => {
  const dir = sandbox(null);
  try {
    const r = run(dir, 'migrations-seed.mjs', ['--project-ref', 'abc', '--yes']);
    assert.equal(r.status, 2);
    assert.match(r.stdout, /Could not read the Supabase project ref/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('status: needs a database to name, and the password to read it', () => {
  const dir = sandbox('homeref123');
  try {
    const r = run(dir, 'migrations-status.mjs', ['--json']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /SUPABASE_DB_PASSWORD not set/);
    assert.equal(r.stdout, '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('upgrade: refuses a folder that is not a backend fork', () => {
  const dir = sandbox('homeref123');
  try {
    const r = run(dir, 'upgrade.mjs', ['--dry-run']);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /not a Digital Home backend/);
    assert.ok(!existsSync(join(dir, '.git')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('migration 003 creates the history table service-role only', () => {
  const sql = readFileSync(join(ROOT, 'supabase', 'migrations', '003_schema_migrations.sql'), 'utf8');
  assert.deepEqual(labels(extractMarkers(sql)), ['table schema_migrations']);
  assert.match(sql, /name text primary key/);
  assert.match(sql, /check \(repo in \('frontend', 'backend'\)\)/);
  assert.match(sql, /applied_at timestamptz not null default now\(\)/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table schema_migrations from anon, authenticated/);
  assert.doesNotMatch(sql, /create policy/);
});
