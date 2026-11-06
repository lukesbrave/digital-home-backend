#!/usr/bin/env node
/** Install a verified starter pair into one empty project. Both transports run the same SQL. */
import { openSync, closeSync, writeSync, fsyncSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { normaliseSql } from './lib/migrations.mjs';
import { connect } from './lib/db.mjs';
import { loadEnv, getPassword } from './lib/env.mjs';
import { historySql, pairedMigrations } from './lib/fresh-install-history.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const emptyProject = `select not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind in ('r','p','v','m','S','f'))
 and not exists (select 1 from auth.users)
 and not exists (select 1 from storage.buckets) as empty`;

export async function install({ files, project, receiptsPath, recordOnly, query }) {
  let receipts;
  if (recordOnly) {
    receipts = readFileSync(receiptsPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  } else {
    if ((await query(emptyProject))[0]?.empty !== true) throw new Error('Project is occupied. Stop and consult UPGRADE.md.');
    // Exclusive create prevents overwriting receipts from a previous or interrupted installation.
    const fd = openSync(receiptsPath, 'wx', 0o600);
    receipts = [];
    try {
      for (const file of files) {
        const receipt = { project, repo: file.repo, name: file.name, checksum: file.checksum };
        try {
          // One multi-statement request per file. A lost acknowledgement requires review.
          const confirmation = JSON.stringify(receipt).replaceAll("'", "''");
          const result = await query(normaliseSql(file.sql) + "\nselect '" + confirmation + "'::jsonb as receipt;");
          if (!isDeepStrictEqual(result, [{receipt}])) throw new Error('Missing database acknowledgement.');
        } catch (cause) {
          throw new Error(file.repo + '/' + file.name + ': execution unconfirmed. Stop without replaying.', { cause });
        }
        writeSync(fd, JSON.stringify(receipt) + '\n');
        fsyncSync(fd);
        receipts.push(receipt);
      }
    } finally { closeSync(fd); }
  }
  await query(historySql(files, receipts, project));
  const rows = await query('select repo,name,checksum from public.schema_migrations order by repo,name');
  const expected = files.map(({ repo,name,checksum }) => ({ repo,name,checksum }))
    .sort((a,b) => a.repo.localeCompare(b.repo) || a.name.localeCompare(b.name));
  if (!isDeepStrictEqual(rows, expected)) throw new Error('History readback mismatch. Stop before handover.');
  return rows;
}

async function main() {
  const { values: args } = parseArgs({options: {
    frontend: {type:'string'}, 'project-ref': {type:'string'}, receipts: {type:'string'},
    preflight: {type:'boolean'}, direct: {type:'boolean'}, 'password-stdin': {type:'boolean'},
    'record-only': {type:'boolean'}, yes: {type:'boolean'},
  }});
  const files = pairedMigrations(root, args.frontend);
  if (args.preflight) { console.log('Paired release verified:', files.length, 'official files.'); return; }
  const project = args['project-ref'];
  if (!/^[a-z0-9]{20}$/.test(project ?? '') || loadEnv([root]).ref !== project || !args.yes || !args.receipts) {
    throw new Error('Confirm the project in this checkout’s .env.local and pass --project-ref, --receipts and --yes.');
  }
  let client;
  try {
    let query;
    if (args.direct) {
      client = await connect(project, await getPassword(args));
      query = async sql => {
        const result = await client.query(sql);
        return Array.isArray(result) ? result.at(-1).rows : result.rows;
      };
    } else {
      const token = process.env.SUPABASE_ACCESS_TOKEN;
      if (!token) throw new Error('Provide the Management API token through the protected environment.');
      query = async sql => {
        const response = await fetch('https://api.supabase.com/v1/projects/' + project + '/database/query', {
          method: 'POST', redirect: 'error', headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'},
          body: JSON.stringify({ query: sql }),
        });
        if (!response.ok) throw new Error('Management API returned HTTP ' + response.status);
        const rows = await response.json();
        if (!Array.isArray(rows)) throw new Error('Unexpected Management API response.');
        return rows;
      };
    }
    const rows = await install({files, project, receiptsPath: args.receipts, recordOnly: args['record-only'], query});
    console.log('Verified', rows.length, 'exact migration records for', project);
  } finally { await client?.end(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error(err.message, err.cause?.message ?? ''); process.exitCode = 1; });
}
