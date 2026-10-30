import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as signing from './signing.ts';
import * as scopes from './agent-key-scopes.ts';
import {scopedRouteAllowed} from './scoped-routes.ts';
import type {AuthResult} from './auth.ts';

// Execute the actual auth implementation with synthetic credentials and provider
// boundaries. Neither the developer's environment nor a real database is read.
function fixture(overrides:Record<string,string>={}, grants=['events:read']) {
 const env={API_SECRET_KEY:'test-master',CONTENT_AGENT_API_KEY:'test-old-agent',API_REQUEST_SIGNING_SECRET:'test-signing',...overrides};
 let keyLookups=0;
 const dependencies:Record<string,unknown>={
  'next/server':{},
  '@/lib/supabase/server':{createAdminClient:()=>({}),createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'test-owner',app_metadata:{}}},error:null})}})},
  './signing':signing,'./agent-key-scopes':scopes,'./scoped-routes':{scopedRouteAllowed},
  './agent-keys':{verifyAgentKey:async()=>{keyLookups++;return {name:'simon',scopes:grants};}},
 };
 const js=ts.transpileModule(readFileSync(new URL('./auth.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const loaded={exports:{} as {authenticateSessionOrApiKey:(request:Request)=>Promise<AuthResult>}};
 new Function('require','module','exports','process',js)((id:string)=>{assert.ok(id in dependencies,id);return dependencies[id];},loaded,loaded.exports,{env});
 return {auth:loaded.exports.authenticateSessionOrApiKey,lookups:()=>keyLookups};
}
function request(key:string,path='/api/events',method='GET',secret='test-signing',signed=true) {
 const time=String(Math.floor(Date.now()/1000));
 const headers:Record<string,string>={'x-api-key':key};
 if(signed){headers['x-timestamp']=time;headers['x-signature']=signing.computeSignature(secret,signing.buildSigningPayload(method,path,time,''));}
 return new Request('https://test.invalid'+path,{method,headers});
}
const minted='bbk_simon_'+ 'a'.repeat(32);
test('old master and env-agent signed requests keep working without the new key table',async()=>{
 const f=fixture();
 for(const key of ['test-master','test-old-agent']) assert.equal((await f.auth(request(key,'/api/crm/leads','POST'))).authenticated,true);
 assert.equal(f.lookups(),0);
});
test('legacy explicit unsigned mode is preserved but never bypasses minted signatures',async()=>{
 const f=fixture({API_SIGNATURE_REQUIRED:'false'});
 assert.equal((await f.auth(request('test-old-agent','/api/crm/leads','GET','',false))).authenticated,true);
 assert.equal((await f.auth(request(minted,'/api/events','GET','',false))).authenticated,false);
});
test('minted keys self-sign, cannot use the legacy secret, and are confined to reviewed routes',async()=>{
 const f=fixture();
 assert.equal((await f.auth(request(minted))).authenticated,false);
 assert.equal((await f.auth(request(minted,'/api/events','GET',minted))).authenticated,true);
 for(const [path,method] of [['/api/settings/agent-keys','POST'],['/api/crm/tick','POST'],['/api/crm/leads','GET'],['/api/events','POST'],['/api/crm/products','GET']]) {
  assert.equal((await f.auth(request(minted,path,method,minted))).authenticated,false,`${method} ${path}`);
 }
});
test('wrong legacy signatures are rejected and owner login is unchanged',async()=>{
 const f=fixture();assert.equal((await f.auth(request('test-old-agent','/api/home','GET','wrong'))).authenticated,false);
 const result=await f.auth(new Request('https://test.invalid/api/home'));
 assert.equal(result.authenticated,true);if(result.authenticated)assert.equal(result.mode,'session');
});
test('checkout-only key cannot read orders, mint keys, send invoices or use invented routes',()=>{
 assert.equal(scopedRouteAllowed('POST','/api/crm/checkout',['money:checkout']),true);
 for(const [method,path] of [['GET','/api/crm/orders'],['POST','/api/settings/agent-keys'],['POST','/api/crm/invoices'],['POST','/api/crm/checkout/anything']])assert.equal(scopedRouteAllowed(method,path,['money:checkout']),false);
});
