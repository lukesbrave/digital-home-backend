// Run actual route handlers with isolated database/provider doubles. No model spend.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
const temp = await mkdtemp(join(tmpdir(), 'article-media-test-'));
const fixture = await sharp({create:{width:1800,height:1200,channels:3,background:'#1f738c'}}).png().toBuffer();
process.env.API_SECRET_KEY = 'sandbox-test-secret';
process.env.ANTHROPIC_API_KEY = 'sandbox-anthropic';
process.env.OPENAI_API_KEY = 'sandbox-openai';
const mocks = {
  'next/server': `export class NextRequest extends Request { get nextUrl() { return new URL(this.url); } } export class NextResponse extends Response { static json(body, init) {return Response.json(body,init);} }`,
  '@/lib/supabase/server': `export function createAdminClient(){return globalThis.__case.db;} export async function createClient(){return {auth:{getUser:async()=>({data:{user:null},error:'no session'})}};}`,
  '@opennextjs/cloudflare': `export function getCloudflareContext(){return {env:globalThis.__case.env};}`,
  '@anthropic-ai/sdk': `export default class Anthropic {messages={create:async()=>{globalThis.__case.writes++;return {content:[{type:'text',text:JSON.stringify({title:'Cedar article',slug:'cedar-article',body:'<p>Helpful article copy.</p>',excerpt:'Article',seo:{title:'Cedar article'}})}]};}};}`,
  'openai': `export default class OpenAI {images={generate:async(params)=>{globalThis.__case.imageCalls++;globalThis.__case.imageParams=params;if(globalThis.__case.providerFails)throw Error('test provider unavailable');return {data:[{b64_json:globalThis.__case.fixture}]};}};}`,
};
function scenario(mode='automatic') {
  const state = {mode,fixture:fixture.toString('base64'),writes:0,imageCalls:0,puts:0,articles:[],providerFails:false,
    card:{id:'card',status:'approved',title:'Cedar article',target_keyword:'studio',content_object_id:null},rows:new Map()};
  const context = ['playbook_audience','playbook_positioning','playbook_voice','playbook_standing_rules','playbook_never_say','playbook_proof','playbook_offer_core']
    .map(key=>({key,category:'brand',content:'Fictional Cedar Lane Studio'}));
  if(mode!==null)context.push({key:'article_image_mode',category:'content',content:mode});
  state.db = {from(table) {
    const filters={};let update;
    const q={select(){return q},eq(k,v){filters[k]=v;return q},order(){return q},limit(){return q},update(v){update=v;return q},
      async single(){const r=await q;return {...r,data:Array.isArray(r.data)?r.data[0]||null:r.data}},async maybeSingle(){return q.single()},
      then(resolve,reject){let data;
        if(table==='content_calendar'){if(update)Object.assign(state.card,update);data={...state.card};}
        else if(table==='backend_settings')data={value:'autonomous'};
        else if(table==='brand_context')data=context.filter(r=>Object.entries(filters).every(([k,v])=>r[k]===v));
        else if(table==='offers')data=[];
        else if(table==='content_objects'){const article=state.articles[0];if(update&&article)Object.assign(article,update);data=article||null;}
        else if(table==='seo_meta')data={og_image_url:state.articles[0]?.seo?.og_image_url};
        else throw Error('Unexpected table '+table);
        return Promise.resolve({data,error:null}).then(resolve,reject);}};return q;
  },storage:{from(){throw Error('Supabase storage must not be used')}}};
  const bucket={async put(key,bytes,meta){state.puts++;const value={size:bytes.byteLength,httpMetadata:meta.httpMetadata};state.rows.set(key,value);return value;},async head(key){return state.rows.get(key)||null}};
  state.env={PUBLIC_MEDIA:bucket,IMAGES:{async info(stream){const meta=await sharp(Buffer.from(await new Response(stream).arrayBuffer())).metadata();return {width:meta.width,height:meta.height};},input(stream){let options;return {transform(o){options=o;return this;},async output({quality}){const bytes=Buffer.from(await new Response(stream).arrayBuffer());const encoded=await sharp(bytes).resize({width:options.width,height:options.height,fit:'inside',withoutEnlargement:true}).webp({quality}).toBuffer();return {response(){return new Response(encoded)}}}}}},
    FRONTEND_WORKER:{async fetch(request){const path=new URL(request.url).pathname;if(request.method==='POST'&&path==='/api/content'){const body=await request.json();const row={...body,id:'article-1',seo_meta_id:'seo-1'};state.articles.push(row);return Response.json({id:row.id,slug:row.slug});}return Response.json({data:[]});}}};
  globalThis.__case=state;return state;
}
function request(path, body, signed=true){const text=JSON.stringify(body),timestamp=String(Math.floor(Date.now()/1000));const headers={'content-type':'application/json'};
  if(signed)Object.assign(headers,{'x-api-key':process.env.API_SECRET_KEY,'x-timestamp':timestamp,'x-signature':createHmac('sha256',process.env.API_SECRET_KEY).update(`POST:${path}:${timestamp}:${text}`).digest('hex')});
  const req=new Request('https://backend.test'+path,{method:'POST',headers,body:text});req.nextUrl=new URL(req.url);return req;
}
try {
  const handlers={};
  for(const route of ['write-article','publish']){
    const out=join(temp,route+'.mjs');
    await build({entryPoints:[`src/app/api/${route}/route.ts`],outfile:out,bundle:true,platform:'node',format:'esm',logLevel:'silent',plugins:[{name:'test-adapters',setup(b){
      b.onResolve({filter:/.*/},args=>mocks[args.path]?{path:args.path,namespace:'mock'}:undefined);
      b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[args.path]}));
    }}]});handlers[route]=(await import(pathToFileURL(out))).POST;
  }
  let s=scenario();let res=await handlers['write-article'](request('/api/write-article',{calendar_entry_id:'card',publish_mode:'safe'},false));assert.equal(res.status,401);assert.equal(s.writes,0);
  res=await handlers['write-article'](request('/api/write-article',{calendar_entry_id:'card',publish_mode:'safe'}));let result=await res.json();assert.equal(res.status,200,JSON.stringify(result));assert.equal(result.image_status,'ready');assert.equal(s.card.status,'draft');assert.equal(s.card.content_object_id,'article-1');assert.equal(s.puts,1);assert.equal(s.imageParams.output_format,'webp');assert(s.articles[0].featured_image_url.startsWith('https://backend.test/media/public/blog/'));assert.equal(s.articles[0].seo.og_image_url,s.articles[0].featured_image_url);
  res=await handlers.publish(request('/api/publish',{calendar_entry_id:'card'}));assert.equal(res.status,200,await res.text());assert.equal(s.card.status,'published');
  s=scenario();s.providerFails=true;res=await handlers['write-article'](request('/api/write-article',{calendar_entry_id:'card',publish_mode:'autonomous'}));result=await res.json();assert.equal(result.image_status,'failed');assert.equal(result.publication_blocked,true);assert.equal(s.card.status,'draft');assert.equal(s.articles.length,1);assert.equal(s.articles[0].status,'draft');
  res=await handlers.publish(request('/api/publish',{calendar_entry_id:'card'}));assert.equal(res.status,409);assert.equal(s.card.status,'draft');
  s=scenario();delete s.env.PUBLIC_MEDIA;res=await handlers['write-article'](request('/api/write-article',{calendar_entry_id:'card'}));assert.equal(res.status,500);assert.equal(s.writes,0);assert.equal(s.imageCalls,0);assert.equal(s.card.status,'approved');
  s=scenario('text_only');res=await handlers['write-article'](request('/api/write-article',{calendar_entry_id:'card',publish_mode:'safe'}));result=await res.json();assert.equal(result.image_status,'text_only');assert.equal(s.imageCalls,0);assert.equal(s.puts,0);
  s.articles[0].featured_image_url='https://old.supabase.co/storage/v1/object/public/images/hero.png';res=await handlers.publish(request('/api/publish',{calendar_entry_id:'card'}));assert.equal(res.status,409);
  s=scenario(null);res=await handlers['write-article'](request('/api/write-article',{calendar_entry_id:'card'}));assert.equal(res.status,500);assert.equal(s.imageCalls,0);assert.equal(s.writes,0);
  console.log('PASS: actual writer/publish handlers; HMAC auth; R2 hero + OG; safe draft; image failure preserves copy and blocks autonomous/manual publication; preflight prevents model spend; text-only skips imagery; legacy Supabase image blocked; missing preference rejected. Database and model providers are test doubles.');
} finally {delete globalThis.__case;await rm(temp,{recursive:true,force:true});}
