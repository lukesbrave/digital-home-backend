import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,chmod,symlink,rm,realpath,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {captureFiles,verifyFiles} from './lib/recovery-files.mjs';
async function fixture(fn){const dir=await realpath(await mkdtemp('/tmp/dh-receipt-'));await chmod(dir,0o700);const root=join(dir,'artifacts');await mkdir(root,{mode:0o700});try{await fn(root,join(dir,'receipt.json'));}finally{await rm(dir,{recursive:true,force:true});}}
test('integrity checks retain unusual names and detect extra/missing files and modes',()=>fixture(async(root,receipt)=>{
 await writeFile(join(root,'__proto__'),'member file',{mode:0o600});await mkdir(join(root,'empty'),{mode:0o700});
 await captureFiles(root,receipt);assert.equal((await verifyFiles(root,receipt)).ok,true);
 assert.ok(Object.hasOwn(JSON.parse(await readFile(receipt,'utf8')).files,'__proto__'));
 await chmod(join(root,'__proto__'),0o644);assert.equal((await verifyFiles(root,receipt)).ok,false);
 await chmod(join(root,'__proto__'),0o600);await writeFile(join(root,'unexpected'),'extra');assert.equal((await verifyFiles(root,receipt)).ok,false);
 await rm(join(root,'unexpected'));await rm(join(root,'empty'),{recursive:true});assert.equal((await verifyFiles(root,receipt)).ok,false);
}));
test('receipts cannot overwrite, live inside the artifact tree, or follow links',()=>fixture(async(root,receipt)=>{
 await writeFile(join(root,'backup.dump'),'synthetic');
 await assert.rejects(captureFiles(root,join(root,'receipt.json')),/outside/);
 await captureFiles(root,receipt);await assert.rejects(captureFiles(root,receipt),/EEXIST/);
 await symlink(receipt,join(root,'linked'));await assert.rejects(verifyFiles(root,receipt),/Links/);
}));
test('receipt capture refuses git checkouts and world-readable receipt folders',()=>fixture(async(root,receipt)=>{
 const parent=join(root,'..');await chmod(parent,0o755);await assert.rejects(captureFiles(root,receipt),/private/);await chmod(parent,0o700);
 await mkdir(join(parent,'.git'));await assert.rejects(captureFiles(root,receipt),/outside git/);
}));
