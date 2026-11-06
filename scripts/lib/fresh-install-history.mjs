/** Pure release preflight and the single history transaction used by both install transports. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { isFrontendCheckout, listMigrations, skippedFiles } from './migrations.mjs';

const literal = value => "'" + value.replaceAll("'", "''") + "'";
const manifest = dir => JSON.parse(readFileSync(join(dir, 'RELEASE-PAIR.json'), 'utf8'));
export function pairedMigrations(root, frontend) {
  if (!frontend || !isFrontendCheckout(frontend)) throw new Error('Pass the paired frontend checkout.');
  const pair = manifest(root);
  if (pair.format !== 'starter_release_pair_v1' || !isDeepStrictEqual(pair, manifest(frontend))) {
    throw new Error('Backend and frontend release manifests differ or have an unsupported format.');
  }
  const migrations = [];
  for (const [repo, dir] of [['frontend', frontend], ['backend', root]]) {
    const version = readFileSync(join(dir, 'VERSION'), 'utf8').trim();
    if (!version || version !== pair[repo].version || version !== pair.backend.version ||
        pair[repo].repository !== 'lukesbrave/digital-home-' + repo) {
      throw new Error(repo + ': release version or repository mismatch.');
    }
    const folder = join(dir, 'supabase/migrations');
    const files = listMigrations(folder, repo);
    if (files.some(file => !file.starterOwned)) throw new Error('Member migrations found. Use UPGRADE.md.');
    const expected = pair[repo].migrations;
    if (!files.length || skippedFiles(folder).length || files.length !== expected.length) {
      throw new Error(repo + ': release migration inventory mismatch.');
    }
    for (const [index, file] of files.entries()) {
      if (file.name !== expected[index].name || file.checksum !== 'sha256:' + expected[index].sha256) {
        throw new Error(repo + '/' + file.name + ': release migration name or hash mismatch.');
      }
    }
    migrations.push(...files);
  }
  return migrations;
}

// Critical fields used by discovery, login-adjacent agent access, tracking and CRM capture.
const requiredColumns = {
  visitors: ['id', 'anonymous_id'], leads: ['id', 'email', 'first_name'],
  content_objects: ['status'], offers: ['status'], backend_settings: ['key', 'value'],
  agent_keys: ['key_hash'], home_events: ['action'], agent_actions: ['status', 'payload'],
};

function markerPredicate(marker) {
  const name = literal(marker.name);
  if (marker.kind === 'table') {
    return `exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=${name} and c.relkind in ('r','p') and c.relrowsecurity)`;
  }
  const table = literal(marker.table);
  if (marker.kind === 'column') return `exists (select 1 from information_schema.columns where table_schema='public' and table_name=${table} and column_name=${name})`;
  if (marker.kind === 'trigger') return `exists (select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=${table} and t.tgname=${name} and not t.tgisinternal and t.tgenabled in ('O','A'))`;
  if (marker.kind === 'policy') {
    const predicates = {
      content_objects: "(status = 'published'::content_status)",
      offers: "(status = 'active'::offer_status)",
    };
    return `exists (select 1 from pg_policies where schemaname='public' and tablename=${table}
      and policyname=${name} and cmd='SELECT' and permissive='PERMISSIVE'
      and roles = array['anon','authenticated']::name[] and qual=${literal(predicates[marker.table])})`;
  }
  throw new Error('Unsupported schema marker: ' + marker.kind);
}

export function historySql(files, receipts, project) {
  const identities = files.map(({ repo, name, checksum }) => ({ project, repo, name, checksum }));
  if (!project || !isDeepStrictEqual(identities, receipts)) {
    throw new Error('Missing or mismatched per-file execution receipts for this project. Stop and review.');
  }
  const markers = files.flatMap(file => file.markers);
  for (const [table, columns] of Object.entries(requiredColumns)) {
    for (const name of columns) markers.push({ kind: 'column', table, name });
  }
  const checks = markers.map(marker => {
    const error = 'Incomplete fresh install: ' + [marker.kind, marker.table, marker.name].filter(Boolean).join(' ');
    return `if not (${markerPredicate(marker)}) then raise exception ${literal(error)}; end if;`;
  });
  const rows = files.map(m => `(${literal(m.repo)}, ${literal(m.name)}, ${literal(m.checksum)})`).join(',\n');
  return `begin;
set local search_path to pg_catalog, public;
lock table public.schema_migrations in exclusive mode;
do $fresh_history$
begin
${checks.join('\n')}
  if (select count(*) from pg_policies where schemaname='public') <> 2 then
    raise exception 'Incomplete fresh install: unexpected public access policies';
  end if;
  if exists (
    select 1 from public.schema_migrations h
    left join (values ${rows}) expected(repo,name,checksum) using(repo,name)
    where expected.name is null or h.checksum is distinct from expected.checksum
  ) then raise exception 'Existing or conflicting migration history: stop and use UPGRADE.md'; end if;
end;
$fresh_history$;
insert into public.schema_migrations(repo,name,checksum,applied_by)
select repo,name,checksum,'fresh-install' from (values ${rows}) expected(repo,name,checksum)
on conflict(repo,name) do nothing;
commit;`;
}
