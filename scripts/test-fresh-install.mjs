import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { historySql } from './fresh-install-history.mjs';
import { backendRoots } from './lib/context.mjs';
import { findFrontend, listMigrations, computeStatus, summarise } from './lib/migrations.mjs';
import { readState, seedHistory } from './lib/db.mjs';
import { seedRows } from './lib/migrations.mjs';
import { homeContract } from '../src/lib/home/contract.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const frontend = findFrontend(process.env.STARTER_FRONTEND_PATH, backendRoots(root)).path;
assert.ok(frontend, 'Set STARTER_FRONTEND_PATH to the paired frontend checkout.');
const files = [...listMigrations(join(frontend,'supabase/migrations'),'frontend'), ...listMigrations(join(root,'supabase/migrations'),'backend')];
assert.equal(files.length,19);
async function rawInstall(skip) {
  const db = new PGlite({extensions:{uuid_ossp}});
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean);
    create table storage.objects(id uuid primary key,bucket_id text);`);
  for (const m of files) if (m.name !== skip) await db.exec(m.sql);
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
    const cli=spawnSync(process.execPath,['scripts/fresh-install-history.mjs','--frontend',frontend],{cwd:root,encoding:'utf8'});
    assert.equal(cli.status,0,cli.stderr);
    await db.exec(cli.stdout);
    const rows=await history(db);
    assert.deepEqual(rows.map(r=>[r.repo,r.name,r.checksum]).sort(),files.map(m=>[m.repo,m.name,m.checksum]).sort());
    assert.deepEqual(discovered(rows),expectedModules);
    const state=await readState(db);
    const statuses=computeStatus(files,state.history,state.catalog);
    assert.deepEqual(summarise(statuses),{applied:19,inferred:0,partial:0,pending:0});
    assert.ok(statuses.every(s=>s.checksumMatches && !s.markers.missing.length));
    await db.exec("insert into leads(email,first_name) values('fresh@example.test','Fresh')");
    const lead=(await db.query('select * from leads')).rows;
    await db.exec(cli.stdout);
    assert.deepEqual(await history(db),rows,'rerun keeps history timestamps unchanged');
    assert.deepEqual((await db.query('select * from leads')).rows,lead,'history recording preserves application data');
    assert.equal((await db.query("select has_table_privilege('anon','schema_migrations','SELECT') allowed")).rows[0].allowed,false);
    assert.equal((await db.query("select has_table_privilege('authenticated','schema_migrations','INSERT') allowed")).rows[0].allowed,false);
  } finally { await db.close(); }
});

test('incomplete schema stops the entire history write',async()=>{
  const db=await rawInstall('008_agent_approvals.sql');
  try {
    await assert.rejects(db.exec(historySql(root,frontend)),/Incomplete fresh install/);
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
      await assert.rejects(db.exec(historySql(root,frontend)),/Existing or conflicting migration history/);
      await db.exec('rollback');
      assert.deepEqual(await history(db),before);
    } finally {await db.close();}
  }
});

test('existing direct-connection seed alternative records the same exact paired history',async()=>{
  const db=await rawInstall();
  try {
    const state=await readState(db);
    const rows=seedRows(computeStatus(files,state.history,state.catalog),new Map(files.map(m=>[`${m.repo}/${m.name}`,m])),'2026-11-04');
    assert.equal(rows.length,19);
    await seedHistory(db,{rows});
    assert.deepEqual(discovered(await history(db)),expectedModules);
    const after=await readState(db);
    assert.deepEqual(summarise(computeStatus(files,after.history,after.catalog)),{applied:19,inferred:0,partial:0,pending:0});
  } finally {await db.close();}
});

test('generation refuses a skipped frontend, modified official SQL or custom migration',()=>{
  assert.throws(()=>historySql(root,null),/paired frontend/);
  const dir=mkdtempSync(join(tmpdir(),'fresh-history-input-'));
  try {
    mkdirSync(join(dir,'frontend/src/types'),{recursive:true});
    mkdirSync(join(dir,'frontend/supabase'),{recursive:true});
    cpSync(join(frontend,'supabase/migrations'),join(dir,'frontend/supabase/migrations'),{recursive:true});
    cpSync(join(frontend,'src/types/database.ts'),join(dir,'frontend/src/types/database.ts'));
    const migration=join(dir,'frontend/supabase/migrations/001_visitors.sql');
    const original=readFileSync(migration,'utf8');
    writeFileSync(migration,original+'\n-- changed');
    assert.throws(()=>historySql(root,join(dir,'frontend')),/hash mismatch/);
    writeFileSync(migration,original);
    writeFileSync(join(dir,'frontend/supabase/migrations/900_member.sql'),'create table member_data(id int);');
    assert.throws(()=>historySql(root,join(dir,'frontend')),/Member migrations found/);
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
      await assert.rejects(db.exec(historySql(root,frontend)),/Incomplete fresh install/);
      await db.exec('rollback');
      assert.deepEqual(await history(db),[]);
    } finally {await db.close();}
  }
});
