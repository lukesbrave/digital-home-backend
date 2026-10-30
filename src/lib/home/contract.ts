export type MigrationRecord={repo:string;name:string;checksum:string|null;applied_at:string};
export type BuildManifest={version:string|null;commit:string|null;built_at:string;known_migrations:string[]};
export function homeContract(manifest:BuildManifest|null,history:MigrationRecord[]|null,safeMode:boolean|null){
 return {
  format:'home_contract_v1',version:manifest?.version??null,build:{sha:manifest?.commit??null,time:manifest?.built_at??null},
  capabilities:{crm:true,content:true,analytics:true,agent_keys:true,mcp:false,money:true,events:true},
  safe_mode:safeMode,
  module_schema:{
   agent_keys:history===null?null:history.some(r=>r.repo==='backend'&&r.name==='004_agent_keys.sql'),
   events:history===null?null:history.some(r=>r.repo==='backend'&&r.name==='005_home_events.sql'),
   money:history===null?null:history.some(r=>r.repo==='backend'&&r.name==='006_money.sql'),
   payment_receipts:history===null?null:history.some(r=>r.repo==='backend'&&r.name==='007_payment_receipts.sql'),
  },
  migrations:{known:manifest?.known_migrations??[],applied:history},
  guide:'/api/home/guide',
 };
}
export const HOME_GUIDE={
 format:'home_guide_v1',
 authentication:'Existing admin session or signed API key. Existing env keys retain their signing mode. New minted keys self-sign and are restricted to explicitly reviewed routes; unknown routes are refused.',
 routes:[
  {method:'GET',scope:'settings:read',path:'/api/home',purpose:'Installed version, capabilities and actual migration history.',approval:'none'},
  {method:'GET',scope:'settings:read',path:'/api/home/guide',purpose:'This candidate’s agent route guide.',approval:'none'},
  {method:'GET',scope:'leads:read',path:'/api/crm/analytics',purpose:'Recorded website/page events; days=0|7|30|90 and optional page.',approval:'none'},
  {method:'GET',scope:'leads:read',path:'/api/crm/funnel',purpose:'Existing funnel report; optional funnel and days.',approval:'none'},
  {method:'GET',path:'/api/events',scope:'events:read',purpose:'Settled activity feed; since cursor, action prefix, lead_id and limit.',approval:'none'},
  {method:'GET',path:'/api/events/stats',scope:'events:read',purpose:'Counts of recorded actions over 24 hours and 7 days.',approval:'none'},
  ...['products','orders','invoices','engagements'].map(name=>({method:'GET',path:`/api/crm/${name}`,scope:'money:read',purpose:'Read money records.',approval:'none'})),
  ...['products','invoices','engagements'].flatMap(name=>['POST','PATCH'].map(method=>({method,path:`/api/crm/${name}`,scope:'money:write',purpose:'Create/update records; invoice send requires configured Stripe and explicit owner instruction.',approval:'owner instruction for financial action'}))),
  {method:'POST',path:'/api/crm/checkout',scope:'money:checkout OR money:write',purpose:'Create hosted checkout; requires both Stripe settings.',approval:'owner instruction'},
  {method:'POST',path:'/api/crm/engagements/from-deal',scope:'money:write',purpose:'Idempotently create a project from a won deal.',approval:'owner instruction'},
  ...['GET','POST','PATCH'].map(method=>({method,path:'/api/crm/engagements/{id}/deliverables',scope:method==='GET'?'money:read':'money:write',purpose:'Read or maintain project deliverables.',approval:method==='GET'?'none':'owner instruction'})),
  ...['GET','POST','DELETE'].map(method=>({method,path:'/api/settings/agent-keys',scope:'owner only',purpose:'List, mint or revoke a scoped key. Never log a mint response.',approval:'owner'})),
  ...['GET','POST'].map(method=>({method,path:'/api/crm/fulfilment',scope:'owner only',purpose:'Inspect or add missing draft recipes; existing custom recipes are preserved.',approval:'owner'})),
 ],
 coverage:'Discovery, Analytics, Money, events and key management. Capabilities mean code is present, not that migrations or payment setup are complete. Other legacy routes remain available to existing credentials; scoped access to them and approvals/MCP are still pending.',
};
