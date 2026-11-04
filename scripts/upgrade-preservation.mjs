#!/usr/bin/env node
// Local code evidence only: never a database/media backup or deployment permission.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { capture, verify } from './lib/preservation.mjs';
const [action,...argv]=process.argv.slice(2);
const args={};
try {
  for(let i=0;i<argv.length;i+=2) {
    if(!['--root','--base','--target','--receipt','--approvals'].includes(argv[i]) || !argv[i+1] || argv[i+1].startsWith('--')) throw new Error('Expected named arguments: --root --base --target --receipt [--approvals]');
    args[argv[i].slice(2)]=argv[i+1];
  }
  if(!args.receipt) throw new Error('--receipt is required; keep it outside the checkout');
  const root=resolve(args.root||'.'), receipt=resolve(args.receipt);
  if(receipt===root || receipt.startsWith(root+'/')) throw new Error('Receipt must be outside the checkout');
  if(action==='capture') {
    if(!args.base||!args.target) throw new Error('--base and --target are required');
    const data=capture(root,args.base,args.target);
    writeFileSync(receipt,JSON.stringify(data,null,2)+'\n',{mode:0o600,flag:'wx'});
    console.log(JSON.stringify({ok:true,protected_paths:Object.keys(data.custom).length,target:data.target}));
  } else if(action==='verify') {
    const result=verify(root,JSON.parse(readFileSync(receipt,'utf8')),args.approvals?JSON.parse(readFileSync(args.approvals,'utf8')):{});
    console.log(JSON.stringify(result,null,2)); process.exitCode=result.ok?0:2;
  } else throw new Error('Use capture or verify');
} catch(e) { console.error(e.message);process.exitCode=1; }
