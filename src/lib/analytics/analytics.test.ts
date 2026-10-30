import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selection,legacyFunnelUrl} from './selection.ts';
import {summariseWebsite} from './website.ts';
test('old funnel bookmarks keep their selected funnel, period and arbitrary filters',()=>{
 const url=new URL(legacyFunnelUrl({funnel:'customer-funnel',days:'90',source:'email',report:'website'}),'https://example.invalid');
 assert.equal(url.pathname,'/crm/analytics');assert.equal(url.searchParams.get('report'),'funnel');assert.equal(url.searchParams.get('source'),'email');
 assert.equal(selection(url.searchParams).funnel,'customer-funnel');assert.equal(selection(url.searchParams).days,90);
});
test('selection handles invalid and missing values without private business defaults',()=>{
 assert.deepEqual(selection(new URLSearchParams()),{report:'website',days:30,funnel:'',page:''});
 assert.equal(selection(new URLSearchParams('days=-1&report=unknown')).days,30);
 assert.equal(selection(new URLSearchParams('days=0')).days,0);
});
test('website counts use existing events, distinguish clicks/captures and strip URL queries',()=>{
 const row=(event_type:string,page_slug:string|null='/pricing',page_url:string|null=null)=>({event_type,page_slug,page_url,created_at:null});
 const data=summariseWebsite([row('page_view'),row('page_view'),row('cta_click'),row('offer_click'),row('email_capture'),row('scroll_depth'),row('page_view',null,'https://customer.example/about?private=value')]);
 assert.equal(data.views,3);assert.equal(data.clicks,2);assert.equal(data.captures,1);assert.equal(data.pages[0].page,'/pricing');assert.equal(data.pages[1].page,'/about');
 assert.ok(!JSON.stringify(data).includes('private'));
});
test('empty data remains an honest zero; unknown locations do not invent pages',()=>{
 assert.deepEqual(summariseWebsite([]),{views:0,clicks:0,captures:0,pages:[]});
 assert.equal(summariseWebsite([{event_type:'page_view',page_slug:null,page_url:'invalid',created_at:null}]).pages[0].page,'(unknown)');
});
