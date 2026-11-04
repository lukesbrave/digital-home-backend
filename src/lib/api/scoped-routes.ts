/** Central fail-closed gate for scoped keys. Legacy env keys retain their contract.
 * Never infer write access from read access, or from an unreviewed route prefix.
 * Owner-only key management, settings, fulfilment setup and worker ticks are absent.
 */
import {hasScope, type Scope} from './agent-key-scopes.ts';
export const SCOPED_ROUTES: readonly {method:string; path:RegExp; scopes:readonly Scope[]}[] = [
 {method:'GET',path:/^\/api\/home(?:\/guide)?$/,scopes:['settings:read']},
 {method:'GET',path:/^\/api\/events(?:\/stats)?$/,scopes:['events:read']},
 {method:'GET',path:/^\/api\/crm\/(?:analytics|funnel)$/,scopes:['leads:read']},
 {method:'GET',path:/^\/api\/crm\/(?:products|orders|invoices|engagements)$/,scopes:['money:read']},
 {method:'GET',path:/^\/api\/crm\/engagements\/[0-9a-f-]{36}\/deliverables$/,scopes:['money:read']},
 {method:'POST',path:/^\/api\/crm\/(?:products|invoices|engagements(?:\/from-deal)?)$/,scopes:['money:write']},
 {method:'PATCH',path:/^\/api\/crm\/(?:products|invoices|engagements)$/,scopes:['money:write']},
 {method:'POST',path:/^\/api\/crm\/engagements\/[0-9a-f-]{36}\/deliverables$/,scopes:['money:write']},
 {method:'PATCH',path:/^\/api\/crm\/engagements\/[0-9a-f-]{36}\/deliverables$/,scopes:['money:write']},
 {method:'POST',path:/^\/api\/crm\/checkout$/,scopes:['money:checkout','money:write']},
];
export function scopedRouteAllowed(method:string,path:string,scopes:readonly string[]):boolean {
 if(scopes.includes('*')) return true;
 return SCOPED_ROUTES.some(r=>r.method===method.toUpperCase() && r.path.test(path) && r.scopes.some(s=>hasScope(scopes,s)));
}
