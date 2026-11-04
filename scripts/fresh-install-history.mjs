#!/usr/bin/env node
/** Generate history SQL after a verified fresh install; never connects to a DB.
 * Run from the backend with --frontend <paired checkout>. Apply the output only
 * to the same verified new project where every listed SQL file succeeded.
 * Existing/customised Homes use UPGRADE.md instead. Catalog markers are a guard,
 * not proof that every statement in a migration ran: keep the execution receipts.
 */
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { listMigrations, parseArgs } from './lib/migrations.mjs';
import { isFrontendCheckout } from './lib/migrations.mjs';

const literal = value => "'" + value.replaceAll("'", "''") + "'";
export function historySql(root, frontend) {
  if (!frontend || !isFrontendCheckout(frontend)) throw new Error('Pass --frontend with the paired frontend checkout; it cannot be skipped.');
  const pair = JSON.parse(readFileSync(join(root, 'RELEASE-PAIR.json'), 'utf8'));
  const migrations = [];
  for (const [repo, dir] of [['frontend', frontend], ['backend', root]]) {
    const files = listMigrations(join(dir, 'supabase/migrations'), repo);
    if (files.some(m => !m.starterOwned)) throw new Error('Member migrations found. This helper is only for a fresh official install; use UPGRADE.md for an existing Home.');
    const expected = pair[repo].migrations;
    if (files.length !== expected.length) throw new Error(`${repo}: migration inventory differs from RELEASE-PAIR.json.`);
    for (const entry of expected) {
      const m = files.find(m => m.name === entry.name);
      if (!m || createHash('sha256').update(m.sql).digest('hex') !== entry.sha256) throw new Error(`${repo}/${entry.name}: release migration hash mismatch.`);
      if (!m.markers.length) throw new Error(`${repo}/${entry.name}: cannot verify schema markers; review required.`);
      migrations.push(m);
    }
  }
  const checks = migrations.flatMap(m => m.markers.map(marker => {
    let predicate;
    if (marker.kind === 'table') predicate = `exists (select 1 from information_schema.tables where table_schema='public' and table_name=${literal(marker.name)})`;
    else if (marker.kind === 'column') predicate = `exists (select 1 from information_schema.columns where table_schema='public' and table_name=${literal(marker.table)} and column_name=${literal(marker.name)})`;
    else if (marker.kind === 'trigger') predicate = `exists (select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=${literal(marker.table)} and t.tgname=${literal(marker.name)} and not t.tgisinternal and t.tgenabled in ('O','A'))`;
    else predicate = `exists (select 1 from pg_policies where schemaname='public' and tablename=${literal(marker.table)} and policyname=${literal(marker.name)})`;
    return `  if not (${predicate}) then raise exception ${literal(`Incomplete fresh install: ${m.repo}/${m.name}; missing ${marker.kind} ${marker.name}`)}; end if;`;
  }));
  const rows = migrations.map(m => `(${literal(m.repo)}, ${literal(m.name)}, ${literal(m.checksum)})`).join(',\n');
  return `-- Fresh install only: all ${migrations.length} paired migration calls must have succeeded.\n-- No migration SQL is replayed. Review the target project before applying.\nbegin;\nlock table public.schema_migrations in exclusive mode;\ndo $fresh_history$\nbegin\n${checks.join('\n')}\n  if exists (\n    select 1 from public.schema_migrations h\n    left join (values ${rows}) expected(repo,name,checksum) using(repo,name)\n    where expected.name is null or h.checksum is distinct from expected.checksum\n  ) then raise exception 'Existing or conflicting migration history: stop and use UPGRADE.md'; end if;\nend;\n$fresh_history$;\ninsert into public.schema_migrations(repo,name,checksum,applied_by)\nselect repo,name,checksum,'fresh-install' from (values ${rows}) expected(repo,name,checksum)\non conflict(repo,name) do nothing;\ncommit;\nselect repo,name,checksum from public.schema_migrations order by repo,name;\n`;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2), ['frontend']);
    if (typeof args.frontend !== 'string') throw new Error('Usage: node scripts/fresh-install-history.mjs --frontend <paired frontend checkout>');
    process.stdout.write(historySql(fileURLToPath(new URL('..', import.meta.url)), resolve(args.frontend)));
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
