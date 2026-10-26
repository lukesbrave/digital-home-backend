/**
 * context.mjs — where the backend, its .env.local and the frontend checkout
 * are, and which migration files each holds. Shared by the status, seed and
 * upgrade scripts.
 */
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectRefFromEnv, readEnvFile } from './db.mjs';
import { findFrontend, listMigrations } from './migrations.mjs';

export const BACKEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The backend folder and, when it is a git worktree, the main checkout's folder. */
export function backendRoots(root = BACKEND_ROOT) {
  const roots = [root];
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const main = dirname(common);
    if (main !== root) roots.push(main);
  } catch {
    // Not a git checkout: the folder itself is all there is.
  }
  return roots;
}

export function loadContext(args, root = BACKEND_ROOT) {
  const env = readEnvFile(join(root, '.env.local'));
  const frontend = findFrontend(typeof args.frontend === 'string' ? args.frontend : null, backendRoots(root));
  const backendMigrations = listMigrations(join(root, 'supabase', 'migrations'), 'backend');
  const frontendMigrations = frontend.path ? listMigrations(join(frontend.path, 'supabase', 'migrations'), 'frontend') : [];
  return {
    root,
    env,
    ref: projectRefFromEnv(env),
    password: process.env.SUPABASE_DB_PASSWORD,
    frontend,
    // Frontend first: it owns the base schema the backend's migrations build on.
    migrations: [...frontendMigrations, ...backendMigrations],
  };
}
