/**
 * migrations.mjs — the pure half of the migration tools: reading migration
 * files, checksums, the objects each migration creates, and deciding what a
 * database has applied. No database access and no dependencies, so
 * scripts/test-upgrade.mjs can test it without a Supabase project.
 *
 * Used by scripts/migrations-status.mjs, scripts/migrations-seed.mjs and
 * scripts/upgrade.mjs.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

export const MIGRATION_FILE = /^\d{3}_[a-z0-9_]+\.sql$/i;

/**
 * What each starter migration creates, read from its `create table` statements
 * (011 creates no table, so its two policies stand in). A database that has
 * every marker for a migration has that migration applied, whether or not
 * `schema_migrations` says so. Files not listed here (a member's own 900+
 * migrations, future starter files) fall back to extractMarkers() on their SQL.
 * test-upgrade.mjs checks this list against the files themselves.
 */
export const KNOWN_MARKERS = {
  frontend: {
    '001_visitors.sql': [table('visitors')],
    '002_content_objects.sql': [table('seo_meta'), table('content_objects')],
    '003_offers.sql': [table('offers')],
    '004_leads_analytics.sql': [table('leads'), table('analytics_events')],
    '005_entities.sql': [table('entities'), table('entity_relationships')],
    '006_personalization_rules.sql': [table('personalization_rules')],
    '007_email_system.sql': [table('email_sequences'), table('email_sends'), table('email_events')],
    '008_conversations.sql': [table('conversations'), table('messages')],
    '009_media_agent_logs.sql': [table('media'), table('agent_logs')],
    '010_content_calendar.sql': [table('content_calendar')],
    '011_security_policies.sql': [
      policy('content_objects', 'Public read published content'),
      policy('offers', 'Public read active offers'),
    ],
  },
  backend: {
    '001_backend_core.sql': [table('backend_settings'), table('brand_context')],
    '002_crm_core.sql': [
      'crm_custom_fields', 'crm_tags', 'pipelines', 'pipeline_stages', 'opportunities',
      'lead_activities', 'email_templates', 'workflows', 'workflow_enrollments', 'crm_tasks',
      'appointments', 'funnel_events', 'social_accounts', 'social_posts', 'social_post_media',
      'social_post_targets', 'social_metrics',
    ].map(table),
    '003_schema_migrations.sql': [table('schema_migrations')],
  },
};

function table(name) {
  return { kind: 'table', name };
}
function column(tableName, name) {
  return { kind: 'column', table: tableName, name };
}
function policy(tableName, name) {
  return { kind: 'policy', table: tableName, name };
}

export function markerLabel(m) {
  if (m.kind === 'table') return `table ${m.name}`;
  if (m.kind === 'column') return `column ${m.table}.${m.name}`;
  return `policy "${m.name}" on ${m.table}`;
}

/** CRLF and a BOM must not change a migration's identity. */
export function normaliseSql(text) {
  return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

export function checksum(text) {
  return 'sha256:' + createHash('sha256').update(normaliseSql(text), 'utf8').digest('hex');
}

/** Drops -- and /* *\/ comments so a table named only in a comment is not a marker. */
export function stripSqlComments(sql) {
  return normaliseSql(sql)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, '');
}

const IDENT = String.raw`(?:"[^"]+"|[a-z_][a-z0-9_$]*)`;
const QUALIFIED = String.raw`(?:${IDENT}\.)?(${IDENT})`;

function unquote(identifier) {
  return identifier.startsWith('"') ? identifier.slice(1, -1) : identifier.toLowerCase();
}

/** The tables, added columns and policies a migration's SQL creates. */
export function extractMarkers(sql) {
  const text = stripSqlComments(sql);
  const markers = [];
  const seen = new Set();
  const add = (m) => {
    const key = markerLabel(m);
    if (!seen.has(key)) {
      seen.add(key);
      markers.push(m);
    }
  };

  const createTable = new RegExp(
    String.raw`\bcreate\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?${QUALIFIED}`,
    'gi',
  );
  for (const m of text.matchAll(createTable)) add(table(unquote(m[1])));

  const alterTable = new RegExp(
    String.raw`\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?${QUALIFIED}([^;]*)`,
    'gi',
  );
  const addColumn = new RegExp(String.raw`\badd\s+column\s+(?:if\s+not\s+exists\s+)?(${IDENT})`, 'gi');
  for (const m of text.matchAll(alterTable)) {
    for (const c of m[2].matchAll(addColumn)) add(column(unquote(m[1]), unquote(c[1])));
  }

  const createPolicy = new RegExp(String.raw`\bcreate\s+policy\s+(${IDENT})\s+on\s+${QUALIFIED}`, 'gi');
  for (const m of text.matchAll(createPolicy)) add(policy(unquote(m[2]), unquote(m[1])));

  return markers;
}

export function markersFor(repo, name, sql) {
  return KNOWN_MARKERS[repo]?.[name] ?? extractMarkers(sql ?? '');
}

/** Every NNN_name.sql in `dir`, in order, with its checksum and markers. */
export function listMigrations(dir, repo) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => MIGRATION_FILE.test(f))
    .sort()
    .map((name) => {
      const path = join(dir, name);
      const sql = readFileSync(path, 'utf8');
      return {
        name,
        repo,
        path,
        sql,
        checksum: checksum(sql),
        markers: markersFor(repo, name, sql),
        starterOwned: Number(name.slice(0, 3)) < 900,
      };
    });
}

/**
 * A snapshot of what exists in the database's public schema, as Sets of
 * `table`, `table.column` and `table|policy` keys. Built from query rows by
 * catalogFromRows() so the rest stays testable.
 */
export function catalogFromRows({ tables = [], columns = [], policies = [] }) {
  return {
    tables: new Set(tables.map((r) => r.table_name)),
    columns: new Set(columns.map((r) => `${r.table_name}.${r.column_name}`)),
    policies: new Set(policies.map((r) => `${r.tablename}|${r.policyname}`)),
  };
}

export function markerPresent(m, catalog) {
  if (m.kind === 'table') return catalog.tables.has(m.name);
  if (m.kind === 'column') return catalog.columns.has(`${m.table}.${m.name}`);
  return catalog.policies.has(`${m.table}|${m.name}`);
}

/**
 * One migration's state:
 *   applied   — schema_migrations has a row for it
 *   inferred  — no row, but every object it creates exists
 *   partial   — no row, and only some of its objects exist (needs a human)
 *   pending   — no row and none of its objects exist (or it creates none
 *               we can look for, and so cannot be inferred)
 */
export function migrationState(migration, recorded, catalog) {
  const present = migration.markers.filter((m) => markerPresent(m, catalog));
  const missing = migration.markers.filter((m) => !markerPresent(m, catalog));
  const base = {
    name: migration.name,
    repo: migration.repo,
    checksum: migration.checksum,
    starterOwned: migration.starterOwned,
    markers: { total: migration.markers.length, present: present.length, missing: missing.map(markerLabel) },
  };
  if (recorded) {
    return {
      ...base,
      status: 'applied',
      recorded: {
        checksum: recorded.checksum ?? null,
        applied_at: recorded.applied_at instanceof Date ? recorded.applied_at.toISOString() : recorded.applied_at ?? null,
        applied_by: recorded.applied_by ?? null,
      },
      checksumMatches: recorded.checksum ? recorded.checksum === migration.checksum : null,
    };
  }
  let status = 'pending';
  if (migration.markers.length > 0 && missing.length === 0) status = 'inferred';
  else if (present.length > 0) status = 'partial';
  return { ...base, status, recorded: null, checksumMatches: null };
}

/** history: rows of schema_migrations, or null when the table does not exist. */
export function computeStatus(migrations, history, catalog) {
  const byName = new Map((history ?? []).map((r) => [`${r.repo}/${r.name}`, r]));
  return migrations.map((m) => migrationState(m, byName.get(`${m.repo}/${m.name}`), catalog));
}

export function summarise(states) {
  const counts = { applied: 0, inferred: 0, partial: 0, pending: 0 };
  for (const s of states) counts[s.status] += 1;
  return counts;
}

/** The rows the one-time seed writes: every inferred migration, nothing else. */
export function seedRows(states, migrationsByKey, date) {
  return states
    .filter((s) => s.status === 'inferred')
    .map((s) => ({
      name: s.name,
      repo: s.repo,
      checksum: migrationsByKey.get(`${s.repo}/${s.name}`).checksum,
      applied_by: `seed:${date}`,
    }));
}

export function formatTable(rows, headers) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length)));
  const line = (cells) => cells.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ').trimEnd();
  return [line(headers), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n');
}

export function statusRows(states) {
  return states.map((s) => {
    let detail = '';
    if (s.status === 'applied') {
      detail = [s.recorded.applied_by, s.recorded.applied_at?.slice(0, 10)].filter(Boolean).join(' ');
      if (s.checksumMatches === false) detail += ' (file changed since it was applied)';
    } else if (s.status === 'partial') {
      detail = `missing ${s.markers.missing.join(', ')}`;
    } else if (s.status === 'pending' && s.markers.total === 0) {
      detail = 'creates nothing to look for: cannot infer';
    } else if (s.status === 'inferred') {
      detail = `${s.markers.present}/${s.markers.total} objects exist, no record`;
    }
    return [s.repo, s.name, s.status, detail];
  });
}

// ── Arguments ────────────────────────────────────────────────────────────────

/** --flag, --key value and --key=value; anything else is positional. */
export function parseArgs(argv, valueFlags = []) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      out._.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const key = arg.slice(2, eq === -1 ? undefined : eq);
    if (eq !== -1) out[key] = arg.slice(eq + 1);
    else if (valueFlags.includes(key)) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new Error(`--${key} needs a value`);
      out[key] = next;
      i++;
    } else out[key] = true;
  }
  return out;
}

/**
 * The gate before anything writes to a database. The ref comes from
 * .env.local; the caller must say it back with --project-ref (Simon reads
 * it aloud to the member first) and pass --yes. Returns null when the gate
 * is open, or the reason it is shut.
 */
export function writeGate({ envRef, projectRef, yes }) {
  if (!envRef) return 'Could not read the Supabase project ref from .env.local (SUPABASE_URL).';
  if (!projectRef || projectRef === true) {
    return `This will write to Supabase project "${envRef}". Confirm it is the member's, then re-run with --project-ref ${envRef} --yes.`;
  }
  if (projectRef !== envRef) {
    return `--project-ref ${projectRef} does not match the database in .env.local ("${envRef}"). Nothing was changed.`;
  }
  if (yes !== true) return `Project "${envRef}" confirmed. Re-run with --yes as well to write.`;
  return null;
}

// ── Finding the frontend checkout ────────────────────────────────────────────

export function isFrontendCheckout(dir) {
  return (
    existsSync(join(dir, 'supabase', 'migrations')) &&
    !existsSync(join(dir, 'src', 'app', 'api', 'write-article')) &&
    existsSync(join(dir, 'src', 'types', 'database.ts'))
  );
}

/**
 * Sibling folders named like the frontend repo. `roots` are the backend's
 * own folder and, in a git worktree, the main checkout's folder.
 */
export function frontendCandidates(roots) {
  const out = [];
  for (const root of roots) {
    const parent = dirname(root);
    const name = basename(root);
    const names = ['digital-home-frontend', 'digital-home-frontend-starter', 'frontend'];
    if (/backend/i.test(name)) names.unshift(name.replace(/backend/i, 'frontend'));
    for (const n of names) {
      const p = resolve(parent, n);
      if (!out.includes(p)) out.push(p);
    }
  }
  return out;
}

export function findFrontend(explicit, roots) {
  if (explicit) {
    const p = resolve(explicit);
    if (!isFrontendCheckout(p)) {
      return { path: null, notice: `--frontend ${explicit} is not a frontend checkout (no supabase/migrations or src/types/database.ts, or it is a backend).` };
    }
    return { path: p, notice: null };
  }
  const found = frontendCandidates(roots).find(isFrontendCheckout);
  if (found) return { path: found, notice: null };
  return {
    path: null,
    notice: 'No frontend checkout found next to this repo; frontend migrations (001-011) are skipped. Pass --frontend <path> to include them.',
  };
}

// ── Upgrade planning ─────────────────────────────────────────────────────────

/** `git diff --name-status --no-renames A B` → { added, modified, deleted }. */
export function classifyDiff(nameStatus) {
  const out = { added: [], modified: [], deleted: [] };
  for (const raw of normaliseSql(nameStatus).split('\n')) {
    if (!raw.trim()) continue;
    const [status, ...rest] = raw.split('\t');
    const path = rest.at(-1);
    const code = status[0];
    if (code === 'A') out.added.push(path);
    else if (code === 'D') out.deleted.push(path);
    else if (code === 'R' && rest.length === 2) {
      // Only if rename detection was left on: treat as delete + add.
      out.deleted.push(rest[0]);
      out.added.push(rest[1]);
    } else out.modified.push(path);
  }
  return out;
}

/** The shared files a member is most likely to have customised; listed first. */
export const SHARED_FILES = [
  'src/components/sidebar.tsx',
  'src/middleware.ts',
  'src/lib/api/auth.ts',
  'src/types/database.ts',
  'package.json',
  'wrangler.jsonc',
  'worker.ts',
];

/** Files the upgrade itself writes, never offered for checkout or merge. */
export const SCRIPT_OWNED = ['VERSION'];

/**
 * Decide what happens to each changed path. `blob(ref, path)` returns the
 * object id of path at ref ('HEAD', the current tag, the target tag), or
 * null when it does not exist there.
 *
 *   checkout       new upstream and absent here: `git checkout <target> -- path`
 *   present        new upstream and already here, identical: nothing to do
 *   conflict       new upstream, but this repo has a different file there: merge by hand
 *   merge          changed upstream and changed here: merge by hand
 *   untouched      changed upstream, unchanged here since the current tag: safe to take
 *   current        changed upstream and already matches the target: nothing to do
 *   removedHere    changed upstream, but this repo deleted it: decide by hand
 *   deletedUpstream gone upstream: left in place, never deleted
 */
export function planFiles(diff, blob, { current, target }) {
  const plan = { checkout: [], present: [], conflict: [], merge: [], untouched: [], current: [], removedHere: [], deletedUpstream: [] };
  for (const path of diff.added) {
    if (SCRIPT_OWNED.includes(path)) continue;
    const here = blob('HEAD', path);
    if (here === null) plan.checkout.push(path);
    else if (here === blob(target, path)) plan.present.push(path);
    else plan.conflict.push(path);
  }
  for (const path of diff.modified) {
    if (SCRIPT_OWNED.includes(path)) continue;
    const here = blob('HEAD', path);
    if (here === null) plan.removedHere.push(path);
    else if (here === blob(target, path)) plan.current.push(path);
    else if (here === blob(current, path)) plan.untouched.push(path);
    else plan.merge.push(path);
  }
  // The shared files first, in the order UPGRADE.md has always listed them.
  const order = (p) => (SHARED_FILES.includes(p) ? SHARED_FILES.indexOf(p) : SHARED_FILES.length);
  for (const key of ['merge', 'untouched']) plan[key].sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  for (const path of diff.deleted) {
    if (blob('HEAD', path) !== null) plan.deletedUpstream.push(path);
  }
  return plan;
}

/** Shell-quote a path for a command the human will copy. */
export function shq(s) {
  return /^[A-Za-z0-9_./@:=+-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

/** v1.2.3 tags, newest first; pre-releases (v2.9.0-beta.1) are never a default target. */
export function releaseTags(tagList) {
  return normaliseSql(tagList)
    .split('\n')
    .map((t) => t.trim())
    .filter((t) => /^v\d+\.\d+\.\d+$/.test(t))
    .sort((a, b) => compareVersions(b.slice(1), a.slice(1)));
}

export function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}
