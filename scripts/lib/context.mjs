/**
 * context.mjs — where the backend, its .env.local and the frontend checkout
 * are, and which migration files each holds. Shared by the status, seed and
 * upgrade scripts.
 */
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './env.mjs';
import { findFrontend, listMigrations, skippedFiles } from './migrations.mjs';

const SCRIPTS_PARENT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function gitOut(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/** The repo root holding these scripts (git's top level), else the scripts' parent folder. */
export function repoRoot(from = SCRIPTS_PARENT) {
  return gitOut(from, ['rev-parse', '--show-toplevel']) ?? from;
}

/** The repo root and, when it is a git worktree, the main checkout's folder. */
export function backendRoots(root = repoRoot()) {
  const roots = [root];
  const common = gitOut(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (common) {
    const main = dirname(common);
    if (main !== root) roots.push(main);
  }
  return roots;
}

export function loadContext(args, root = repoRoot()) {
  const roots = backendRoots(root);
  const envFile = loadEnv(roots);
  const frontend = findFrontend(typeof args.frontend === 'string' ? args.frontend : null, roots);
  const backendDir = join(root, 'supabase', 'migrations');
  const frontendDir = frontend.path ? join(frontend.path, 'supabase', 'migrations') : null;
  const notices = [];
  if (frontend.notice) notices.push(frontend.notice);
  for (const [dir, label] of [[frontendDir, 'frontend'], [backendDir, 'backend']]) {
    if (!dir) continue;
    const skipped = skippedFiles(dir);
    if (skipped.length) notices.push(`Ignored in the ${label}'s supabase/migrations (not named NNN_name.sql): ${skipped.join(', ')}`);
  }
  return {
    root,
    envFile,
    ref: envFile.ref,
    frontend,
    notices,
    // Frontend first: it owns the base schema the backend's migrations build on.
    migrations: [...(frontendDir ? listMigrations(frontendDir, 'frontend') : []), ...listMigrations(backendDir, 'backend')],
  };
}
