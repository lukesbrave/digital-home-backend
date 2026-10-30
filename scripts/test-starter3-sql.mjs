import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {uuid_ossp} from '@electric-sql/pglite/contrib/uuid_ossp';
const sql=name=>readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
const newFiles=['004_agent_keys.sql','005_home_events.sql','006_money.sql','007_payment_receipts.sql'];
async function baseline(){
 const db=new PGlite({extensions:{uuid_ossp}});
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create schema storage; create table storage.buckets(id text primary key,name text,public boolean);
 create table storage.objects(id uuid primary key,bucket_id text);
 `);
 await db.exec(readFileSync(new URL('./fixtures/frontend-2.5.4.sql',import.meta.url),'utf8'));
 for(const file of ['001_backend_core.sql','002_crm_core.sql','003_schema_migrations.sql'])await db.exec(sql(file));
 return db;
}
async function migrate(db){for(const file of newFiles)await db.transaction(async tx=>{await tx.exec(sql(file));await tx.query('insert into schema_migrations(repo,name) values ($1,$2)',['backend',file]);});}
test('fresh paired starter schema installs new modules with owner-only tables',async()=>{
 const db=await baseline();try{
  await migrate(db);
  const tables=['agent_keys','home_events','products','orders','order_items','engagements','engagement_deliverables','invoices','invoice_items','payment_events','payouts'];
  for(const table of tables){
   assert.equal((await db.query('select relrowsecurity from pg_class where oid=$1::regclass',[table])).rows[0].relrowsecurity,true);
   assert.equal((await db.query("select has_table_privilege('anon',$1,'SELECT') allowed",[table])).rows[0].allowed,false);
   assert.equal((await db.query("select has_table_privilege('authenticated',$1,'UPDATE') allowed",[table])).rows[0].allowed,false);
  }
 }finally{await db.close();}
});
test('custom columns, custom tables, workflow copy, settings and old queries survive migration',async()=>{
 const db=await baseline();try{
  await db.exec(`alter table leads add column member_segment text;
   create table member_assets(id integer primary key,notes text);
   insert into member_assets values(1,'Member owns this');
   insert into leads(email,first_name,member_segment,custom,tags) values('member@example.test','Member','VIP','{"colour":"purple"}','{custom}');
   insert into backend_settings(key,value) values('member_brand','{"font":"MyFont"}');
   insert into workflows(name,status,steps) values('My workflow','paused','[{"id":"custom","type":"wait","config":{"days":42}}]');`);
  const snapshot=async()=>({leads:(await db.query('select * from leads')).rows,assets:(await db.query('select * from member_assets')).rows,settings:(await db.query('select * from backend_settings order by key')).rows,workflows:(await db.query('select * from workflows order by id')).rows});
  const before=await snapshot();await migrate(db);assert.deepEqual(await snapshot(),before);
  await db.exec("update leads set first_name='Still editable' where email='member@example.test'");
  assert.equal((await db.query('select member_segment from leads')).rows[0].member_segment,'VIP');
 }finally{await db.close();}
});
test('an existing member products table blocks adoption without changing its data',async()=>{
 const db=await baseline();try{
  await db.exec("create table products(id integer primary key, custom text);insert into products values(1,'keep me')");
  await assert.rejects(db.transaction(tx=>tx.exec(sql('006_money.sql'))),/existing products table requires a reviewed adoption/);
  assert.deepEqual((await db.query('select * from products')).rows,[{id:1,custom:'keep me'}]);
  assert.equal((await db.query("select to_regclass('orders') value")).rows[0].value,null);
 }finally{await db.close();}
});
test('payment completion emits one receipt atomically; repeats and ignored events do not duplicate it',async()=>{
 const db=await baseline();try{
  await migrate(db);
  await db.exec("insert into payment_events(provider,provider_event_id,type,payload) values('stripe','evt_fixture','invoice.paid','{}')");
  await db.exec("update payment_events set processed_at=now(),result='{}' where provider_event_id='evt_fixture'");
  await db.exec("update payment_events set processed_at=now() where provider_event_id='evt_fixture'");
  assert.equal((await db.query('select count(*)::int n from home_events')).rows[0].n,1);
  assert.deepEqual((await db.query('select action,payload,evidence from home_events')).rows[0],{action:'payment.processed',payload:{},evidence:{webhook_id:'evt_fixture'}});
  await db.exec("insert into payment_events(provider,provider_event_id,type,payload) values('stripe','evt_ignored','ignored','{}')");
  await db.exec(`update payment_events set processed_at=now(),result='{"ignored":"test-mode disabled"}' where provider_event_id='evt_ignored'`);
  assert.equal((await db.query('select count(*)::int n from home_events')).rows[0].n,1);
  await assert.rejects(db.transaction(async tx=>{await tx.exec("insert into payment_events(provider,provider_event_id,type,payload) values('stripe','evt_rollback','invoice.paid','{}');update payment_events set processed_at=now(),result='{}' where provider_event_id='evt_rollback'");throw new Error('simulate crash');}),/simulate crash/);
  assert.equal((await db.query('select count(*)::int n from home_events')).rows[0].n,1);
 }finally{await db.close();}
});
