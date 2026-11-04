import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync,spawnSync } from 'node:child_process';
import { capture,verify,fingerprint,safePath } from './lib/preservation.mjs';
function fixture(t) {
 const root=mkdtempSync(join(tmpdir(),'starter3-preserve-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init','-q');git('config','user.email','test@example.invalid');git('config','user.name','Fixture');
 writeFileSync(join(root,'layout.tsx'),'starter');writeFileSync(join(root,'removed.ts'),'remove me');
 git('add','layout.tsx','removed.ts');git('commit','-qm','baseline');const base=git('rev-parse','HEAD');
 writeFileSync(join(root,'new.ts'),'target feature');git('add','new.ts');git('commit','-qm','target');const target=git('rev-parse','HEAD');
 git('checkout','-qb','member',base);
 writeFileSync(join(root,'layout.tsx'),'member custom design');rmSync(join(root,'removed.ts'));
 mkdirSync(join(root,'custom'));writeFileSync(join(root,'custom/feature.ts'),'client feature');
 git('add','layout.tsx','removed.ts','custom/feature.ts');git('commit','-qm','customise');
 return {root,git,base,target};
}
test('capture detects additions, edits and deletions; new upstream code leaves them intact',t=>{
 const f=fixture(t),r=capture(f.root,f.base,f.target);assert.equal(Object.keys(r.custom).length,3);assert.equal(r.custom['removed.ts'],null);
 f.git('checkout',f.target,'--','new.ts');assert.equal(verify(f.root,r).ok,true);
 assert.equal(readFileSync(join(f.root,'layout.tsx'),'utf8'),'member custom design');
});
test('overwriting custom code, deleting additions and resurrecting deleted files all fail',t=>{
 const f=fixture(t),r=capture(f.root,f.base,f.target);
 writeFileSync(join(f.root,'layout.tsx'),'upstream replacement');rmSync(join(f.root,'custom/feature.ts'));writeFileSync(join(f.root,'removed.ts'),'resurrected');
 assert.deepEqual(verify(f.root,r).changed.sort(),['custom/feature.ts','layout.tsx','removed.ts']);
});
test('review approval is bound to exact after bytes and requires a reason',t=>{
 const f=fixture(t),r=capture(f.root,f.base,f.target);writeFileSync(join(f.root,'layout.tsx'),'reviewed merge');
 const a={'layout.tsx':{reason:'Custom layout retained, new link tested',after:fingerprint(f.root,'layout.tsx')}};
 assert.equal(verify(f.root,r,a).ok,true);a['layout.tsx'].reason='';assert.equal(verify(f.root,r,a).ok,false);
 a['layout.tsx'].reason='reviewed';writeFileSync(join(f.root,'layout.tsx'),'changed again');assert.equal(verify(f.root,r,a).ok,false);
});
test('dirty capture refuses without altering work; receipts contain hashes not client content',t=>{
 const f=fixture(t);const r=capture(f.root,f.base,f.target);assert.ok(!JSON.stringify(r).includes('member custom design'));
 writeFileSync(join(f.root,'layout.tsx'),'uncommitted');assert.throws(()=>capture(f.root,f.base,f.target),/Uncommitted/);
 assert.equal(readFileSync(join(f.root,'layout.tsx'),'utf8'),'uncommitted');
});
test('mode changes are detected; symlink targets are hashed without following them',t=>{
 const f=fixture(t),r=capture(f.root,f.base,f.target);chmodSync(join(f.root,'layout.tsx'),0o755);assert.equal(verify(f.root,r).ok,false);
 symlinkSync('/does/not/exist',join(f.root,'link'));assert.equal(fingerprint(f.root,'link').mode,'120000');
 symlinkSync('/tmp',join(f.root,'outside'));assert.throws(()=>fingerprint(f.root,'outside/private'),/Symlink/);
 for(const path of ['../secret','/secret','.git/config','x/../../secret'])assert.equal(safePath(path),false);
});
test('CLI never overwrites a receipt and rejects a receipt in the checkout',t=>{
 const f=fixture(t),dir=mkdtempSync(join(tmpdir(),'starter3-receipt-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const script=new URL('./upgrade-preservation.mjs',import.meta.url).pathname;
 const run=receipt=>spawnSync(process.execPath,[script,'capture','--root',f.root,'--base',f.base,'--target',f.target,'--receipt',receipt],{encoding:'utf8'});
 const receipt=join(dir,'before.json');assert.equal(run(receipt).status,0);const bytes=readFileSync(receipt,'utf8');assert.equal(run(receipt).status,1);assert.equal(readFileSync(receipt,'utf8'),bytes);
 assert.equal(run(join(f.root,'receipt.json')).status,1);
});
test('old-Simon runbook requires no card or training replacement and preserves deploy approval',()=>{
 const text=readFileSync(new URL('../UPGRADE-3.md',import.meta.url),'utf8');
 for(const phrase of ['No employee rehire','not a new employee personality','Stop\n    for production approval','A real old-Simon rehearsal is still'])assert.ok(text.includes(phrase),phrase);
});
