import { NextRequest, NextResponse } from 'next/server';
import { authenticateSessionOrApiKey, unauthorizedResponse } from '@/lib/api/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { summariseWebsite, websitePage } from '@/lib/analytics/website';
import { selection } from '@/lib/analytics/selection';
export async function GET(request:NextRequest) {
  const auth=await authenticateSessionOrApiKey(request);
  if(!auth.authenticated) return unauthorizedResponse(auth.error);
  const {days,page}=selection(request.nextUrl.searchParams);
  try {
    const db=createAdminClient(), rows=[];
    let truncated=false;
    const until=new Date().toISOString();
    for(let offset=0;offset<=50000;offset+=1000) {
      let q=db.from('analytics_events').select('event_type,page_slug,page_url,created_at').lte('created_at',until)
        .in('event_type',['page_view','cta_click','offer_click','email_capture'])
        .order('created_at',{ascending:false}).order('id',{ascending:false});
      if(days) q=q.gte('created_at',new Date(Date.parse(until)-days*86400000).toISOString());
      const {data,error}=await q.range(offset,offset+999);
      if(error) throw new Error('Could not read website analytics');
      if(offset===50000) {truncated=Boolean(data?.length);break;}
      rows.push(...(data||[]));
      if(!data||data.length<1000) break;
    }
    return NextResponse.json({...summariseWebsite(page?rows.filter(row=>websitePage(row)===page):rows),days,page,truncated,events_scanned:rows.length,generated_at:until},{headers:{'Cache-Control':'no-store'}});
  } catch {return NextResponse.json({error:'Could not load website analytics. Try again.'},{status:500});}
}
