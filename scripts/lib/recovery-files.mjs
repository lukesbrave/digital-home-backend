/** Byte-integrity evidence for private recovery artifacts. Not a backup or a
 * completeness claim. Never follows links, overwrites a receipt, or prints data.
 */
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat,readdir,readFile,writeFile,realpath} from 'node:fs/promises';
import {join,resolve,relative,dirname} from 'node:path';
async function hash(path){const h=createHash('sha256');for await(const chunk of createReadStream(path))h.update(chunk);return h.digest('hex');}
export async function inventory(root){
 const base=resolve(root);if((await lstat(base)).isSymbolicLink())throw new Error('Linked root refused');
 if(await realpath(base)!==base)throw new Error('Linked parent refused');
 const result=Object.create(null);
 result['.']={kind:'directory',mode:(await lstat(base)).mode & 0o777};
 async function walk(dir){
  for(const name of (await readdir(dir)).sort()){
   const path=join(dir,name), key=relative(base,path), stat=await lstat(path);
   if(stat.isSymbolicLink()||(!stat.isFile()&&!stat.isDirectory()))throw new Error('Links and special files are not recovery artifacts');
   if(name==='.git')throw new Error('Use a git bundle, not a live .git directory');
   result[key]={kind:stat.isDirectory()?'directory':'file',mode:stat.mode & 0o777,...(stat.isFile()?{bytes:stat.size,sha256:await hash(path)}:{})};
   if(stat.isDirectory())await walk(path);
  }
 }
 await walk(base);return result;
}
async function privateDestination(file,root){
 const dest=resolve(file),base=await realpath(resolve(root));
 if(dest===base||dest.startsWith(base+'/'))throw new Error('Receipt must be outside the artifact tree');
 let parent=dirname(dest);if(await realpath(parent)!==parent)throw new Error('Linked receipt parent refused');
 for(let p=parent;;p=dirname(p)){
  try{await lstat(join(p,'.git'));throw new Error('Recovery receipts must stay outside git');}catch(e){if(e.code!=='ENOENT')throw e;}
  if(dirname(p)===p)break;
 }
 if((await lstat(parent)).mode & 0o077)throw new Error('Receipt directory must be private (0700)');
 return dest;
}
export async function captureFiles(root,file){
 const dest=await privateDestination(file,root);
 const receipt={format:'home_recovery_files_v1',files:await inventory(root)};
 await writeFile(dest,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});return {files:Object.keys(receipt.files).length};
}
export async function verifyFiles(root,file){
 if((await lstat(file)).isSymbolicLink())throw new Error('Linked receipt refused');
 const receipt=JSON.parse(await readFile(file,'utf8'));
 if(receipt.format!=='home_recovery_files_v1'||!receipt.files||typeof receipt.files!=='object'||Array.isArray(receipt.files))throw new Error('Invalid recovery receipt');
 const actual=await inventory(root);
 const names=new Set([...Object.keys(receipt.files),...Object.keys(actual)]);
 const changed=[...names].filter(name=>JSON.stringify(receipt.files[name])!==JSON.stringify(actual[name]));
 return {ok:changed.length===0,checked:names.size,changed};
}
