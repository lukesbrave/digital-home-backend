#!/usr/bin/env node
import {captureFiles,verifyFiles} from './lib/recovery-files.mjs';
const [mode,...args]=process.argv.slice(2);const opts={};
try{
 for(let i=0;i<args.length;i+=2){if(!['--root','--receipt'].includes(args[i])||!args[i+1]||opts[args[i]])throw new Error('Use capture|verify --root <artifacts> --receipt <private receipt>');opts[args[i]]=args[i+1];}
 if(!['capture','verify'].includes(mode)||!opts['--root']||!opts['--receipt'])throw new Error('Use capture|verify --root <artifacts> --receipt <private receipt>');
 const result=await (mode==='capture'?captureFiles:verifyFiles)(opts['--root'],opts['--receipt']);
 // Counts only: paths and contents can themselves contain private data.
 console.log(JSON.stringify({operation:mode,ok:result.ok??true,files:result.files??result.checked,changed:result.changed?.length??0}));
 if(result.ok===false)process.exitCode=1;
}catch{console.error('Recovery integrity check refused or failed. Check paths, private directory permissions and receipt integrity. No files were restored.');process.exitCode=1;}
