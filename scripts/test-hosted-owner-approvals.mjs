// Maintainer-only: pinned synthetic project, no member config or production deploy.
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,openSync,closeSync} from 'node:fs';
import {createHmac,randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../package.json',import.meta.url)),{createClient}=require('@supabase/supabase-js');
const keys=JSON.parse(readFileSync('/private/tmp/starter3-hosted-keys.json'));
const credentials=JSON.parse(readFileSync('/private/tmp/starter3-runtime-private.json'));
const key=n=>keys.find(k=>k.name===n).api_key;
const url='https://iotldbnwtnzpwpyhwgmo.supabase.co',origin='http://127.0.0.1:4125';
const admin=createClient(url,key('service_role'),{auth:{persistSession:false}}),anon=createClient(url,key('anon'),{auth:{persistSession:false}});
const login=await anon.auth.signInWithPassword({email:credentials.email,password:credentials.password});assert.ifError(login.error);
const cookie='sb-iotldbnwtnzpwpyhwgmo-auth-token=base64-'+Buffer.from(JSON.stringify(login.data.session)).toString('base64url');
const employeeKey=randomBytes(32).toString('hex'),log=openSync('/private/tmp/starter3-owner-approvals-app.log','w',0o600);
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','4125'],{env:{...process.env,SUPABASE_URL:url,NEXT_PUBLIC_SUPABASE_URL:url,SUPABASE_ANON_KEY:key('anon'),NEXT_PUBLIC_SUPABASE_ANON_KEY:key('anon'),SUPABASE_SERVICE_ROLE_KEY:key('service_role'),API_SECRET_KEY:credentials.master,API_REQUEST_SIGNING_SECRET:credentials.master,CONTENT_AGENT_API_KEY:employeeKey,API_SIGNATURE_REQUIRED:'true',SOCIAL_PUBLISHING_ENABLED:'false'},stdio:['ignore',log,log]});
let keyId;
const signed=(path,method,body,token=credentials.master,secret=credentials.master)=>{const timestamp=String(Math.floor(Date.now()/1000)),pathname=new URL(path,origin).pathname;return {'content-type':'application/json','x-api-key':token,'x-timestamp':timestamp,'x-signature':createHmac('sha256',secret).update([method,pathname,timestamp,body].join(':')).digest('hex')};};
const req=async(path,{method='GET',body,token,secret,session=false,status=200}={})=>{const text=body===undefined?'':JSON.stringify(body),r=await fetch(origin+path,{method,headers:session?{cookie,'content-type':'application/json'}:signed(path,method,text,token,secret),body:method==='GET'?undefined:text});const data=await r.json();assert.equal(r.status,status,path+': '+(data.error??r.status));return data;};
try{
 let ready=false;for(let i=0;i<70;i++){try{if((await fetch(origin+'/api/agent/actions')).status===401){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,300));}assert.ok(ready);
 const minted=await req('/api/settings/agent-keys',{method:'POST',body:{name:'owner-flow-'+Date.now(),scopes:['approvals:propose','leads:read','content:write']},session:true,status:201});const token=minted.key.plaintext;keyId=minted.key.id;
 const proposal=async(label)=>{const response=await fetch(origin+'/api/mcp',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'article.propose',arguments:{title:'Synthetic Buzz owner '+label,target_keyword:'owner connection '+label+' '+Date.now()}}})});assert.equal(response.status,200);const data=await response.json();assert.equal(data.result.isError,false);return JSON.parse(data.result.content[0].text).action_id;};
 const approvedId=await proposal('approve'),rejectedId=await proposal('reject');assert.ok(approvedId&&rejectedId);
 const reviewed=await req('/api/agent/actions/'+approvedId);assert.equal(reviewed.action.status,'proposed');assert.equal(reviewed.action.payload.proposed_by,minted.key.name);
 assert.ok((await req('/api/agent/actions?status=proposed')).actions.some(a=>a.id===approvedId));
 await req('/api/agent/actions/'+approvedId,{session:true});
 for(const [path,method] of [['/api/agent/actions','GET'],['/api/agent/actions/'+approvedId,'GET'],['/api/agent/actions/'+approvedId,'POST']]){
  const body=method==='POST'?{decision:'approve'}:undefined;
  await req(path,{method,body,token,secret:token,status:401});
  await req(path,{method,body,token:employeeKey,status:401});
  await req(path,{method,body,secret:'wrong-signature',status:401});
  const anonymous=await fetch(origin+path,{method,body:body?JSON.stringify(body):undefined});assert.equal(anonymous.status,401);
 }
 await req('/api/agent/actions/'+approvedId,{method:'POST',body:{decision:'unknown'},status:400});
 const approved=await req('/api/agent/actions/'+approvedId,{method:'POST',body:{decision:'approve'}});assert.equal(approved.status,'executed');assert.ok(approved.result.calendar_entry_id);
 await req('/api/agent/actions/'+approvedId,{method:'POST',body:{decision:'approve'},status:409});
 const rejected=await req('/api/agent/actions/'+rejectedId,{method:'POST',body:{decision:'reject'}});assert.equal(rejected.status,'rejected');
 const rows=await admin.from('home_events').select('action,actor_type,actor').in('action',['approval.executed','approval.rejected']).eq('actor','master');assert.ifError(rows.error);assert.ok(rows.data.some(x=>x.action==='approval.executed'&&x.actor_type==='agent'));assert.ok(rows.data.some(x=>x.action==='approval.rejected'&&x.actor_type==='agent'));
 assert.equal((await fetch(origin+'/crm/approvals',{headers:{cookie}})).status,404);
 const content=await fetch(origin+'/content',{headers:{cookie}});assert.equal(content.status,200);assert.ok(!(await content.text()).includes('href="/crm/approvals"'));
 const receipt={format:'starter3_owner_agent_approvals_v1',at:new Date().toISOString(),project:'iotldbnwtnzpwpyhwgmo',proposals_via_scoped_mcp:true,signed_owner_queue_and_detail:true,owner_session_read_retained:true,signed_owner_approve_and_reject:true,duplicate_refused:true,invalid_decision_refused:true,scoped_employee_refused:true,legacy_named_employee_refused:true,unsigned_anonymous_and_bad_signatures_refused:true,audit_actor_is_agent_not_fabricated_human:true,default_approvals_route_absent:true,sidebar_link_absent:true,limitations:['HTTP transport proof for the existing owner-authorised Buzz agent connection; no native Buzz approval plugin or proof of human chat consent','Synthetic article proposals only; no email send, social publication or member data changes']};
 writeFileSync('/private/tmp/starter3-owner-approvals-receipt.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));
}finally{if(keyId)await req('/api/settings/agent-keys?id='+keyId,{method:'DELETE',session:true}).catch(()=>{});child.kill('SIGTERM');closeSync(log);}
