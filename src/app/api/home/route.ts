import {NextRequest,NextResponse} from 'next/server';
import {authenticateSessionOrApiKey,unauthorizedResponse} from '@/lib/api/auth';
import {createAdminClient} from '@/lib/supabase/server';
import {homeContract,type BuildManifest,type MigrationRecord} from '@/lib/home/contract';
export async function GET(request:NextRequest){
 const auth=await authenticateSessionOrApiKey(request);if(!auth.authenticated)return unauthorizedResponse(auth.error);
 let manifest:BuildManifest|null=null;try{manifest=JSON.parse(process.env.HOME_BUILD_MANIFEST||'null');}catch{}
 let history:MigrationRecord[]|null=null,safeMode:boolean|null=null;
 try{
  const db=createAdminClient();
  const records:MigrationRecord[]=[];
  for(let offset=0;;offset+=1000){
   const {data,error}=await db.from('schema_migrations').select('repo,name,checksum,applied_at').order('repo').order('name').range(offset,offset+999);
   if(error)throw new Error('history unavailable');
   records.push(...(data||[]));if(!data||data.length<1000)break;
  }
  history=records;
 }catch{/* Unknown history is null, never a claim that all migrations applied. */}
 try{
  const {data,error}=await createAdminClient().from('backend_settings').select('value').eq('key','crm_safe_mode').maybeSingle();
  if(!error && typeof data?.value==='boolean')safeMode=data.value;
 }catch{}
 return NextResponse.json(homeContract(manifest,history,safeMode),{headers:{'Cache-Control':'no-store'}});
}
