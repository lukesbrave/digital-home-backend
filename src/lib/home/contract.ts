export type MigrationRecord={repo:string;name:string;checksum:string|null;applied_at:string};
export type BuildManifest={version:string|null;commit:string|null;built_at:string;known_migrations:string[]};
export function homeContract(manifest:BuildManifest|null,history:MigrationRecord[]|null,safeMode:boolean|null){
 return {
  format:'home_contract_v1',version:manifest?.version??null,build:{sha:manifest?.commit??null,time:manifest?.built_at??null},
  capabilities:{crm:true,content:true,analytics:true,agent_keys:false,mcp:false,money:false},
  safe_mode:safeMode,
  migrations:{known:manifest?.known_migrations??[],applied:history},
  guide:'/api/home/guide',
 };
}
export const HOME_GUIDE={
 format:'home_guide_v1',
 authentication:'Existing admin session or the Home’s existing signed API key. This candidate has not introduced scoped keys.',
 routes:[
  {method:'GET',path:'/api/home',purpose:'Installed version, capabilities and actual migration history.',approval:'none'},
  {method:'GET',path:'/api/home/guide',purpose:'This candidate’s read-only discovery guide.',approval:'none'},
  {method:'GET',path:'/api/crm/analytics',purpose:'Recorded website/page events; days=0|7|30|90 and optional page.',approval:'none'},
  {method:'GET',path:'/api/crm/funnel',purpose:'Existing funnel report; optional funnel and days.',approval:'none'},
 ],
 coverage:'Discovery and Analytics only; not yet the complete Starter 3.0 agent guide.',
};
