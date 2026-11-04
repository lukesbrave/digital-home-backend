import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import type {BuildManifest} from './contract';
export function buildManifest(root:string):BuildManifest {
 let commit=null;try{commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{}
 return {version:readFileSync(join(root,'VERSION'),'utf8').trim(),commit,built_at:new Date().toISOString(),known_migrations:readdirSync(join(root,'supabase/migrations')).filter(x=>/^\d{3}_.*\.sql$/.test(x)).sort()};
}
