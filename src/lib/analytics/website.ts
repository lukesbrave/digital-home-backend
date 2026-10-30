export type WebsiteEvent = { event_type:string; page_slug:string|null; page_url:string|null; created_at:string|null };
// Report recorded events, never pretend identifiers are people or clicks are sales.
export function websitePage(row: WebsiteEvent) {
  if(row.page_slug) return row.page_slug;
  if(row.page_url) { try { return new URL(row.page_url).pathname; } catch {} }
  return '(unknown)';
}
export function summariseWebsite(rows: WebsiteEvent[]) {
  const pages = new Map<string,{page:string;views:number;clicks:number;captures:number}>();
  let views=0,clicks=0,captures=0;
  for(const row of rows) {
    const page=websitePage(row);
    const item=pages.get(page)||{page,views:0,clicks:0,captures:0};
    if(row.event_type==='page_view') {views++;item.views++;}
    if(row.event_type==='cta_click'||row.event_type==='offer_click') {clicks++;item.clicks++;}
    if(row.event_type==='email_capture') {captures++;item.captures++;}
    pages.set(page,item);
  }
  return {views,clicks,captures,pages:[...pages.values()].sort((a,b)=>b.views-a.views||a.page.localeCompare(b.page))};
}
