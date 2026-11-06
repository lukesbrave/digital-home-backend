import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { historySql, pairedMigrations } from './lib/fresh-install-history.mjs';
import { backendRoots } from './lib/context.mjs';
import { findFrontend, listMigrations, computeStatus, summarise } from './lib/migrations.mjs';
import { readState } from './lib/db.mjs';
import { seedRows } from './lib/migrations.mjs';
import { homeContract } from '../src/lib/home/contract.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const frontend = findFrontend(process.env.STARTER_FRONTEND_PATH, backendRoots(root)).path;
assert.ok(frontend, 'Set STARTER_FRONTEND_PATH to the paired frontend checkout.');
import { install } from './fresh-install.mjs';
const files = [...listMigrations(join(frontend,'supabase/migrations'),'frontend'), ...listMigrations(join(root,'supabase/migrations'),'backend')];
assert.equal(files.length,19);
const project = 'testprojectreference';
const receipts = files.map(({ repo, name, checksum }) => ({ project, repo, name, checksum }));
const recordSql = () => historySql(pairedMigrations(root, frontend), receipts, project);
async function rawInstall(skip) {
  const db = new PGlite({extensions:{uuid_ossp}});
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid); create schema storage; create table storage.buckets(id text primary key,name text,public boolean);
    create table storage.objects(id uuid primary key,bucket_id text);`);
  for (const m of files) if (skip !== 'all' && m.name !== skip) await db.exec(m.sql);
  return db;
}
async function history(db) { return (await db.query('select * from schema_migrations order by repo,name')).rows; }
function discovered(rows) { return homeContract(null,rows,true).module_schema; }
const expectedModules = {approvals:true,agent_keys:true,events:true,money:true,payment_receipts:true};

// These routes deliver identical training. Each starts with raw per-file SQL,
// matching Simon's Management API sequence; this is not a native Buzz run.
for (const recruitment of ['Team plugin','legacy web card']) test(`${recruitment}: raw paired SQL then generated history enables all module discovery`,async()=>{
  const db=await rawInstall();
  try {
    assert.deepEqual(await history(db),[]);
    assert.ok(Object.values(discovered([])).every(v=>v===false), 'reproduce the release gap');
    await db.exec(recordSql());
    const rows=await history(db);
    assert.deepEqual(rows.map(r=>[r.repo,r.name,r.checksum]).sort(),files.map(m=>[m.repo,m.name,m.checksum]).sort());
    assert.deepEqual(discovered(rows),expectedModules);
    const state=await readState(db);
    const statuses=computeStatus(files,state.history,state.catalog);
    assert.deepEqual(summarise(statuses),{applied:19,inferred:0,partial:0,pending:0});
    assert.ok(statuses.every(s=>s.checksumMatches && !s.markers.missing.length));
    await db.exec("insert into leads(email,first_name) values('fresh@example.test','Fresh')");
    const lead=(await db.query('select * from leads')).rows;
    await db.exec(recordSql());
    assert.deepEqual(await history(db),rows,'rerun keeps history timestamps unchanged');
    assert.deepEqual((await db.query('select * from leads')).rows,lead,'history recording preserves application data');
    assert.equal((await db.query("select has_table_privilege('anon','schema_migrations','SELECT') allowed")).rows[0].allowed,false);
    assert.equal((await db.query("select has_table_privilege('authenticated','schema_migrations','INSERT') allowed")).rows[0].allowed,false);
  } finally { await db.close(); }
});

test('incomplete schema stops the entire history write',async()=>{
  const db=await rawInstall('008_agent_approvals.sql');
  try {
    await assert.rejects(db.exec(recordSql()),/Incomplete fresh install/);
    await db.exec('rollback');
    assert.deepEqual(await history(db),[]);
  } finally {await db.close();}
});

test('conflicting existing checksum or unknown member history is never overwritten',async()=>{
  for (const [repo,name,hash] of [['backend','001_backend_core.sql','sha256:wrong'],['backend','900_member.sql','sha256:member']]) {
    const db=await rawInstall();
    try {
      await db.query('insert into schema_migrations(repo,name,checksum) values($1,$2,$3)',[repo,name,hash]);
      const before=await history(db);
      await assert.rejects(db.exec(recordSql()),/Existing or conflicting migration history/);
      await db.exec('rollback');
      assert.deepEqual(await history(db),before);
    } finally {await db.close();}
  }
});

test('generation refuses a skipped frontend, modified official SQL or custom migration',()=>{
  assert.throws(()=>pairedMigrations(root,null),/paired frontend/);
  const dir=mkdtempSync(join(tmpdir(),'fresh-history-input-'));
  try {
    mkdirSync(join(dir,'frontend/src/types'),{recursive:true});
    mkdirSync(join(dir,'frontend/supabase'),{recursive:true});
    cpSync(join(frontend,'supabase/migrations'),join(dir,'frontend/supabase/migrations'),{recursive:true});
    cpSync(join(frontend,'src/types/database.ts'),join(dir,'frontend/src/types/database.ts'));
    const copy = join(dir,'frontend');
    for (const name of ['VERSION','RELEASE-PAIR.json']) cpSync(join(frontend,name),join(copy,name));
    writeFileSync(join(copy,'VERSION'),'3.0.0');
    assert.throws(()=>pairedMigrations(root,copy),/version or repository mismatch/);
    cpSync(join(frontend,'VERSION'),join(copy,'VERSION'));
    const pair=JSON.parse(readFileSync(join(copy,'RELEASE-PAIR.json'),'utf8'));
    pair.backend.version='3.0.0';
    writeFileSync(join(copy,'RELEASE-PAIR.json'),JSON.stringify(pair));
    assert.throws(()=>pairedMigrations(root,copy),/manifests differ/);
    cpSync(join(frontend,'RELEASE-PAIR.json'),join(copy,'RELEASE-PAIR.json'));
    const migration=join(dir,'frontend/supabase/migrations/001_visitors.sql');
    const original=readFileSync(migration,'utf8');
    writeFileSync(migration,'\uFEFF'+original.replaceAll('\n','\r\n'));
    assert.equal(pairedMigrations(root,copy).length,19);
    writeFileSync(migration,original+'\n-- changed');
    assert.throws(()=>pairedMigrations(root,join(dir,'frontend')),/hash mismatch/);
    writeFileSync(migration,original);
    writeFileSync(join(dir,'frontend/supabase/migrations/900_member.sql'),'create table member_data(id int);');
    assert.throws(()=>pairedMigrations(root,join(dir,'frontend')),/Member migrations found/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('missing or disabled payment receipt trigger is not inferred or recorded',async()=>{
  for (const change of ['drop trigger home_events_payment_processed on payment_events', 'alter table payment_events disable trigger home_events_payment_processed', 'alter table payment_events enable replica trigger home_events_payment_processed']) {
    const db=await rawInstall();
    try {
      await db.exec(change);
      const state=await readState(db);
      const statuses=computeStatus(files,state.history,state.catalog);
      assert.equal(statuses.find(s=>s.name==='007_payment_receipts.sql').status,'pending');
      assert.equal(seedRows(statuses,new Map(files.map(m=>[`${m.repo}/${m.name}`,m])),'2026-11-04').length,18);
      await assert.rejects(db.exec(recordSql()),/Incomplete fresh install/);
      await db.exec('rollback');
      assert.deepEqual(await history(db),[]);
    } finally {await db.close();}
  }
});

test('fresh runner records observed successes and only repeats history on the same project', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'paired-run-'));
  const db = await rawInstall('all');
  const query = async sql => (await db.exec(sql)).at(-1).rows;
  const args = {files, project, query, receiptsPath: join(dir,'receipts.jsonl')};
  try {
    const rows = await install(args);
    assert.equal(rows.length,19);
    const before = await history(db);
    await assert.rejects(install(args), /occupied/);
    assert.deepEqual(await install({...args,recordOnly:true}), rows);
    assert.deepEqual(await history(db),before);
    await assert.rejects(install({...args,recordOnly:true,project:'other'}), /receipts/);
  } finally { await db.close(); rmSync(dir,{recursive:true,force:true}); }
});

test('an interrupted SQL call has no success receipt and cannot be seeded or blindly retried', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'paired-stop-'));
  const db = await rawInstall('all');
  const query = async sql => {
    if (sql.startsWith(files.at(-1).sql)) throw new Error('interrupted');
    return (await db.exec(sql)).at(-1).rows;
  };
  const args = {files,project,query,receiptsPath:join(dir,'receipts.jsonl')};
  try {
    await assert.rejects(install(args), /execution unconfirmed/);
    assert.equal(readFileSync(args.receiptsPath,'utf8').trim().split('\n').length,18);
    await assert.rejects(install({...args,recordOnly:true}), /receipts/);
    await assert.rejects(install(args), /occupied/);
    assert.deepEqual(await history(db),[]);
  } finally { await db.close(); rmSync(dir,{recursive:true,force:true}); }
});

test('critical columns, row security and published-content policy gate the whole history transaction', async () => {
  const db = await rawInstall();
  try {
    for (const sql of [
      'alter table visitors rename column anonymous_id to missing_id',
      'alter table visitors disable row level security',
      'drop policy "Public read published content" on content_objects',
      'alter policy "Public read published content" on content_objects using (true)',
      'create policy "leak" on leads for select to anon using (true)',
    ]) {
      await db.exec('begin; ' + sql);
      await assert.rejects(db.exec(recordSql()), /Incomplete fresh install/);
      await db.exec('rollback');
      assert.deepEqual(await history(db),[]);
    }
  } finally { await db.close(); }
});
