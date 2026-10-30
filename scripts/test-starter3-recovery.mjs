/** Real PostgreSQL recovery rehearsal. Synthetic data only, no network listener,
 * no inherited PG credentials and no live project option. Requires PG_BIN.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,chmodSync,symlinkSync,rmSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {captureFiles,verifyFiles} from './lib/recovery-files.mjs';
const binaries=process.env.PG_BIN;
if(!binaries)throw new Error('Set PG_BIN to local PostgreSQL server binaries. This test must not use a live database.');
const env={PATH:process.env.PATH,LANG:'C',LC_ALL:'C',PGCONNECT_TIMEOUT:'5'};
const root=realpathSync(mkdtempSync('/tmp/dh3-recovery-'));chmodSync(root,0o700);
const data=join(root,'cluster'),socket=join(root,'socket');mkdirSync(socket,{mode:0o700});
// Trust applies only to this user-private Unix socket. TCP is disabled.
const pg=(name,args=[],input)=>execFileSync(join(binaries,name),args,{env,input,encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:64*1024*1024});
const conn=['-h',socket,'-p','55439','-U','recovery_test'];
const query=(db,sql)=>pg('psql',[...conn,'-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-d',db],sql).trim();
const sql=file=>readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8');
const git=(cwd,args)=>execFileSync('git',args,{cwd,env:{...env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'},encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const newFiles=['004_agent_keys.sql','005_home_events.sql','006_money.sql','007_payment_receipts.sql'];
function initRepo(path,label){
 mkdirSync(path);git(path,['init','-b','member']);git(path,['config','user.name','Recovery fixture']);git(path,['config','user.email','fixture@example.test']);
 writeFileSync(join(path,'design.css'),'/* Member custom design */\n:root{--brand:purple}\n');
 writeFileSync(join(path,'custom-route.ts'),`export const memberPage = '${label}';\n`);
 writeFileSync(join(path,'old-page.html'),'removed by member');git(path,['add','design.css','custom-route.ts','old-page.html']);git(path,['commit','-m','Member baseline']);
 rmSync(join(path,'old-page.html'));writeFileSync(join(path,'member-hook.sh'),'#!/bin/sh\nexit 0\n');chmodSync(join(path,'member-hook.sh'),0o755);
 git(path,['add','old-page.html','member-hook.sh']);git(path,['commit','-m','Member customisations']);return git(path,['rev-parse','HEAD']);
}
function rows(db){return query(db,`select jsonb_build_object(
 'leads',(select jsonb_agg(to_jsonb(t) order by id) from leads t),
 'workflows',(select jsonb_agg(to_jsonb(t) order by id) from workflows t),
 'settings',(select jsonb_agg(to_jsonb(t) order by key) from backend_settings t),
 'custom',(select jsonb_agg(to_jsonb(t) order by id) from member_private.assets t),
 'users',(select jsonb_agg(to_jsonb(t) order by id) from auth.users t),
 'buckets',(select jsonb_agg(to_jsonb(t) order by id) from storage.buckets t),
 'objects',(select jsonb_agg(to_jsonb(t) order by id) from storage.objects t),
 'history',(select jsonb_agg(to_jsonb(t) order by repo,name) from schema_migrations t)
 )::text;`);}
function schema(db){return pg('pg_dump',[...conn,'--schema-only','--no-owner',db]).split('\n').filter(l=>!/^\\(?:un)?restrict /.test(l)).join('\n');}
async function restoreFresh(db,archive,artifacts,receipt){
 assert.equal((await verifyFiles(artifacts,receipt)).ok,true,'Corrupt recovery artifacts refused');
 // Refuse an existing database's user objects. Never use --clean or --create.
 assert.equal(query(db,"select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%'"),'0','Nonempty recovery target refused');
 pg('pg_restore',[...conn,'--exit-on-error','--single-transaction','--no-owner','-d',db,archive]);
}
test('actual dump, upgrade failure and separate-target restore preserve a customised paired Home',async t=>{
 let started=false;
 try{
  pg('initdb',['-D',data,'-U','recovery_test','-A','trust','--encoding=UTF8','--no-locale']);
  pg('pg_ctl',['-D',data,'-l',join(root,'postgres.log'),'-o',`-h '' -k ${socket} -p 55439`,'-w','start']);started=true;
  for(const name of ['member_source','member_recovered','member_tamper'])pg('createdb',[...conn,name]);
  query('member_source',`create role anon;create role authenticated;create role service_role bypassrls;
   create schema storage;create table storage.buckets(id text primary key,name text,public boolean);
   create table storage.objects(id uuid primary key,bucket_id text,name text,metadata jsonb);
   create schema auth;create table auth.users(id uuid primary key,email text,fixture_login_verifier text);
   create schema member_private;create table member_private.assets(id bigint generated always as identity primary key,notes text,metadata jsonb);
   create function member_private.label(text) returns text language sql immutable as $$select 'Member ' || $1$$;
   create view member_private.asset_labels as select id,member_private.label(notes) label from member_private.assets;
   alter table member_private.assets enable row level security;
   create policy member_read on member_private.assets for select to authenticated using(true);
   grant usage on schema member_private to authenticated;grant select on member_private.assets to authenticated;`);
  query('member_source',readFileSync(new URL('./fixtures/frontend-2.5.4.sql',import.meta.url),'utf8'));
  for(const file of ['001_backend_core.sql','002_crm_core.sql','003_schema_migrations.sql'])query('member_source',sql(file));
  query('member_source',`alter table leads add column member_segment text;
   insert into leads(email,first_name,member_segment,tags,custom) values('fixture@example.test','Original','VIP','{member-tag}','{"brand":"purple"}');
   insert into member_private.assets(notes,metadata) values('owned asset','{"nested":[1,2,3]}');
   insert into auth.users values('11111111-1111-4111-8111-111111111111','owner@example.test','synthetic-login-fixture');
   insert into storage.buckets values('legacy','legacy',false);
   insert into storage.objects values('22222222-2222-4222-8222-222222222222','legacy','image.bin','{"contentType":"application/octet-stream"}');
   insert into backend_settings(key,value) values('member_brand','{"font":"Personal font"}');
   insert into workflows(name,status,steps) values('Member edited workflow','paused','[{"id":"custom","type":"wait","config":{"days":42}}]');
   insert into schema_migrations(repo,name,checksum) values('backend','900_member_custom.sql','fixture-custom-checksum');`);
  const before=rows('member_source'),beforeSchema=schema('member_source');
  const artifacts=join(root,'artifacts');mkdirSync(artifacts,{mode:0o700});
  const archive=join(artifacts,'database.dump');pg('pg_dump',[...conn,'--format=custom','--file',archive,'member_source']);chmodSync(archive,0o600);
  const heads={};for(const name of ['backend','frontend']){const path=join(root,name);heads[name]=initRepo(path,name);git(path,['bundle','create',join(artifacts,name+'.bundle'),'--all']);}
  for(const folder of ['media/r2','media/legacy-storage','private-config'])mkdirSync(join(artifacts,folder),{recursive:true,mode:0o700});
  writeFileSync(join(artifacts,'media/r2/member-banner.bin'),Buffer.from([0,255,4,8,13]));
  writeFileSync(join(artifacts,'media/legacy-storage/image.bin'),'Legacy media bytes');
  writeFileSync(join(artifacts,'private-config/settings.fixture'),'synthetic configuration only\n',{mode:0o600});
  const receipt=join(root,'before.json');await captureFiles(artifacts,receipt);
  await t.test('interrupted migration leaves original data intact',()=>{
   query('member_source',sql(newFiles[0]));
   assert.throws(()=>query('member_source','BEGIN;'+sql(newFiles[1])+"SELECT 1/0;COMMIT;"));
   assert.equal(query('member_source',"select to_regclass('public.home_events') is null"),'t');assert.equal(rows('member_source'),before);
   for(const file of newFiles.slice(1))query('member_source',sql(file));
   assert.equal(rows('member_source'),before);
  });
  await t.test('restore rebuilds custom schema, rows, account/storage metadata, policies and sequences',async()=>{
   query('member_source',"update leads set first_name='Broken';delete from member_private.assets");
   await restoreFresh('member_recovered',archive,artifacts,receipt);
   assert.equal(rows('member_recovered'),before);assert.equal(schema('member_recovered'),beforeSchema);
   assert.equal(query('member_recovered',"insert into member_private.assets(notes) values('next') returning id"),'2');
   assert.equal(query('member_recovered',"select has_table_privilege('authenticated','member_private.assets','SELECT')"),'t');
   assert.equal(query('member_recovered',"select has_table_privilege('anon','member_private.assets','SELECT')"),'f');
   // Legacy application fields remain queryable after recovery.
   assert.equal(query('member_recovered',"select first_name from leads where email='fixture@example.test'"),'Original');
  });
  await t.test('code bundles restore member commits, deleted pages and executable modes',()=>{
   for(const name of ['backend','frontend']){
    const recovered=join(root,'recovered-'+name);git(root,['clone','--branch','member',join(artifacts,name+'.bundle'),recovered]);
    assert.equal(git(recovered,['rev-parse','HEAD']),heads[name]);assert.equal(git(recovered,['status','--porcelain']),'');
    assert.equal(readFileSync(join(recovered,'design.css'),'utf8'),'/* Member custom design */\n:root{--brand:purple}\n');
    assert.match(git(recovered,['ls-files','--stage','member-hook.sh']),/^100755 /);
    assert.equal(git(recovered,['ls-files','old-page.html']),'');
   }
  });
  await t.test('media/configuration artifacts restore byte-for-byte and detect corruption',async()=>{
   const recovered=join(root,'recovered-artifacts');mkdirSync(recovered,{mode:0o700});
   execFileSync('cp',['-pR',artifacts+'/.',recovered],{env});
   assert.equal((await verifyFiles(recovered,receipt)).ok,true);
   writeFileSync(join(recovered,'media/legacy-storage/image.bin'),'corrupted');
   assert.equal((await verifyFiles(recovered,receipt)).ok,false);
   await assert.rejects(restoreFresh('member_tamper',join(recovered,'database.dump'),recovered,receipt),/Corrupt recovery artifacts refused/);
   assert.equal(query('member_tamper',"select to_regclass('public.leads') is null"),'t');
  });
  await t.test('a nonempty target and existing receipts are refused without overwrites',async()=>{
   await assert.rejects(restoreFresh('member_recovered',archive,artifacts,receipt),/Nonempty recovery target refused/);
   await assert.rejects(captureFiles(artifacts,receipt),/EEXIST/);
   assert.equal((await verifyFiles(artifacts,receipt)).ok,true);
   symlinkSync(join(artifacts,'database.dump'),join(artifacts,'linked-dump'));
   await assert.rejects(verifyFiles(artifacts,receipt),/Links/);
  });
 }finally{
  if(started)pg('pg_ctl',['-D',data,'-m','fast','-w','stop']);
  // Only the fresh synthetic fixture directory created by this test is removed.
  rmSync(root,{recursive:true,force:true});
 }
});
