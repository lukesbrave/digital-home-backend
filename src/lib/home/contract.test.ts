import {test} from 'node:test';
import assert from 'node:assert/strict';
import {homeContract,HOME_GUIDE} from './contract.ts';
test('unknown migration state remains unknown instead of implying installation',()=>{
 const h=homeContract(null,null,null);assert.equal(h.version,null);assert.equal(h.migrations.applied,null);assert.equal(h.safe_mode,null);
 assert.equal(h.capabilities.mcp,false);assert.equal(h.capabilities.agent_keys,false);
});
test('actual history and installed version are distinct from known migration filenames',()=>{
 const history=[{repo:'backend',name:'003_schema_migrations.sql',checksum:'sha256:fixture',applied_at:'2026-10-30'}];
 const h=homeContract({version:'2.9.0',commit:'fixture',built_at:'now',known_migrations:['003_schema_migrations.sql','004_pending.sql']},history,true);
 assert.equal(h.version,'2.9.0');assert.deepEqual(h.migrations.applied,history);assert.equal(h.migrations.known.length,2);
 assert.equal(h.safe_mode,true);
});
test('candidate guide does not advertise private or unavailable tools',()=>{
 assert.equal(HOME_GUIDE.routes.length,4);assert.ok(!JSON.stringify(HOME_GUIDE).match(/skool|hermes|bravebrand\.com/));
});
