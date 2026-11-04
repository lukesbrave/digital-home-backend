import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
export function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trimEnd();
}
export function safePath(path) {
  return typeof path === 'string' && path.length > 0 && !path.startsWith('/') && !path.split('/').some(p => p === '..' || p === '.' || p === '.git') && !path.includes('\\') && !path.includes('\0');
}
export function fingerprint(root, path) {
  if (!safePath(path)) throw new Error('Unsafe receipt path');
  // Do not follow links, including links in parent directories.
  const parts = path.split('/');
  for (let i=1;i<parts.length;i++) {
    try { if (lstatSync(join(root,...parts.slice(0,i))).isSymbolicLink()) throw new Error('Symlink parent refused'); }
    catch(e) { if (e.code === 'ENOENT') return null; throw e; }
  }
  const full = join(root,path);
  let stat; try { stat = lstatSync(full); } catch(e) { if(e.code==='ENOENT') return null; throw e; }
  if (!stat.isFile() && !stat.isSymbolicLink()) throw new Error('Non-file receipt path');
  const bytes = stat.isSymbolicLink() ? Buffer.from(readlinkSync(full)) : readFileSync(full);
  return { sha256:createHash('sha256').update(bytes).digest('hex'), mode:stat.isSymbolicLink()?'120000':stat.mode & 0o111?'100755':'100644' };
}
export function capture(root, base, target) {
  if (git(root,['status','--porcelain'])) throw new Error('Uncommitted work: preserve it separately before capture; never stash/reset/clean it.');
  const baseCommit=git(root,['rev-parse','--verify',`${base}^{commit}`]);
  const targetCommit=git(root,['rev-parse','--verify',`${target}^{commit}`]);
  const head=git(root,['rev-parse','HEAD']);
  const paths=git(root,['diff','--name-only','--no-renames','-z',baseCommit,head]).split('\0').filter(Boolean);
  // Protect all member changes, including deletions and files not touched upstream.
  const custom=Object.fromEntries(paths.map(path=>[path,fingerprint(root,path)]));
  return {format:'home_preservation_v1',base:baseCommit,target:targetCommit,head,custom};
}
export function verify(root, receipt, approvals={}) {
  if(receipt.format!=='home_preservation_v1' || !receipt.custom || !/^[a-f0-9]{40}$/.test(receipt.head)) throw new Error('Invalid preservation receipt');
  git(root,['merge-base','--is-ancestor',receipt.head,'HEAD']);
  const changed=[], reviewed=[];
  for(const [path,before] of Object.entries(receipt.custom)) {
    const after=fingerprint(root,path);
    if(JSON.stringify(before)===JSON.stringify(after)) continue;
    const approval=approvals[path];
    if(approval && typeof approval.reason==='string' && approval.reason.trim() && JSON.stringify(approval.after)===JSON.stringify(after)) reviewed.push(path);
    else changed.push(path);
  }
  return {ok:changed.length===0,changed,reviewed,checked:Object.keys(receipt.custom).length};
}
