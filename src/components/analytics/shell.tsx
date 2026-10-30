 'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/components/crm/kit';
import { selection } from '@/lib/analytics/selection';
import type { summariseWebsite } from '@/lib/analytics/website';
import FunnelReport from './funnel-report';
type Report=ReturnType<typeof summariseWebsite>&{truncated:boolean;generated_at:string};
export default function AnalyticsShell() {
 const router=useRouter(),params=useSearchParams();
 const {report,days,funnel,page}=selection(new URLSearchParams(params.toString()));
 const [data,setData]=useState<Report|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{
  if(report!=='website')return;
  const controller=new AbortController();
  // Clear the previous filter result while the replacement request is pending.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  setData(null);setError('');
  api<Report>('/api/crm/analytics?'+new URLSearchParams({days:String(days),page}),{signal:controller.signal})
   .then(result=>{if(!controller.signal.aborted)setData(result);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});
  return()=>controller.abort();
 },[report,days,page,retry]);
 function change(values:Record<string,string>){const q=new URLSearchParams(params.toString());for(const [k,v]of Object.entries(values)){if(v)q.set(k,v);else q.delete(k);}router.replace('/crm/analytics?'+q,{scroll:false});}
 const field='rounded border border-minimal-border bg-minimal-bg px-3 py-2 text-sm';
 return <div className="h-full overflow-y-auto"><header className="p-6 border-b border-minimal-border"><h1 className="text-xl font-semibold">Analytics</h1><p className="text-sm text-minimal-muted mt-2">Your website and funnel performance.</p>
 <div className="flex flex-wrap gap-4 mt-4"><label>Report <select className={field} value={report} onChange={e=>change({report:e.target.value,page:''})}><option value="website">Website</option><option value="funnel">Funnels</option></select></label>
 <label>Period <select className={field} value={days} onChange={e=>change({days:e.target.value})}>{[7,30,90,0].map(n=><option key={n} value={n}>{n?`Last ${n} days`:'All time'}</option>)}</select></label>
 <button className={field} onClick={()=>setRetry(n=>n+1)}>Refresh</button></div></header>
 {report==='funnel'?<FunnelReport key={`${days}:${funnel}:${retry}`} initialDays={days} initialFunnel={funnel}/>:<main className="p-6">
 {page&&<button className={field} onClick={()=>change({page:''})}>All pages</button>}
 {error?<p role="alert">{error}</p>:!data?<p role="status">Loading analytics…</p>:<>
 <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 my-6">{[['Page views',data.views],['CTA / offer clicks',data.clicks],['Email capture events',data.captures]].map(([label,value])=><div key={label} className="border border-minimal-border rounded p-4"><p className="text-sm text-minimal-muted">{label}</p><p className="text-2xl">{value}</p></div>)}</div>
 {data.truncated&&<p role="status">Showing the most recent 50,000 matching events. Totals are partial; choose a shorter period.</p>}
 {!data.pages.length?<p>No recorded website events for this period.</p>:<div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr>{['Page','Views','Clicks','Captures'].map(h=><th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>{data.pages.map(p=><tr key={p.page} className="border-t border-minimal-border"><td className="p-3">{p.page==='(unknown)'?p.page:<button onClick={()=>change({page:p.page})} className="underline">{p.page}</button>}</td><td>{p.views}</td><td>{p.clicks}</td><td>{p.captures}</td></tr>)}</tbody></table></div>}
 <p className="text-xs text-minimal-muted mt-6">Recorded first-party events, not unique people, verified leads or sales. Tracking gaps and duplicate events can affect counts. No external analytics connection is implied. Refreshed {new Date(data.generated_at).toLocaleString()}.</p>
 </>}
 </main>}
 </div>;
}
