export function selection(params: URLSearchParams) {
  const raw = params.get('report') || (params.has('funnel') ? 'funnel' : 'website');
  const report = raw === 'funnel' ? 'funnel' : 'website';
  const n = Number(params.get('days') ?? 30);
  const days = [0,7,30,90].includes(n) ? n : 30;
  const funnel = (params.get('funnel') || '').slice(0,120);
  const page = (params.get('page') || '').slice(0,500);
  const source=(params.get('source')||'').slice(0,120);
  const rawDevice=params.get('device')||'';
  const device=['mobile','tablet','desktop','unknown'].includes(rawDevice)?rawDevice:'';
  return {report,days,funnel,page,source,device};
}
export function legacyFunnelUrl(params: Record<string,string|string[]|undefined>) {
  const query = new URLSearchParams({report:'funnel'});
  for (const [key,value] of Object.entries(params)) if(typeof value==='string') query.set(key,value);
  query.set('report','funnel');
  return '/crm/analytics?'+query.toString();
}
