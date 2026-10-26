/**
 * env.mjs — which database the tools will touch, and its password.
 *
 * The project ref comes from SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) in
 * .env.local, as scripts/apply-migration.mjs reads it. .env.local is ignored
 * by git, so a worktree has none of its own: the repo root's copy is used
 * first, then the main checkout's.
 *
 * The password is never taken from the command line. It comes from the
 * SUPABASE_DB_PASSWORD environment variable, from one line on stdin with
 * --password-stdin, or from a hidden prompt when stdin is a terminal.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Parses .env.local the way apply-migration.mjs does, tolerating CRLF, quotes and `export`. */
export function readEnvFile(path) {
  const env = {};
  if (!existsSync(path)) return env;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^(?:export\s+)?([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^"(.*)"$|^'(.*)'$/, '$1$2');
  }
  return env;
}

export function projectRefFromEnv(env) {
  const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  try {
    return new URL(url).hostname.split('.')[0] || null;
  } catch {
    return null;
  }
}

/** The first .env.local among `roots`, with every path tried for the error message. */
export function loadEnv(roots) {
  const tried = roots.map((r) => join(r, '.env.local'));
  const path = tried.find((p) => existsSync(p)) ?? null;
  const env = path ? readEnvFile(path) : {};
  return { env, path, tried, ref: projectRefFromEnv(env) };
}

export function describeEnv(loaded) {
  if (loaded.path && loaded.ref) return `Supabase project ${loaded.ref} (from ${loaded.path})`;
  if (loaded.path) return `(unknown: ${loaded.path} has no SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL)`;
  return `(unknown: no .env.local at ${loaded.tried.join(' or ')})`;
}

function readLine(stream) {
  return new Promise((resolve, reject) => {
    let data = '';
    stream.setEncoding('utf8');
    const onData = (chunk) => {
      data += chunk;
      const nl = data.search(/\r?\n/);
      if (nl !== -1) done(data.slice(0, nl));
    };
    const done = (value) => {
      stream.off('data', onData);
      stream.off('end', onEnd);
      stream.pause();
      resolve(value);
    };
    const onEnd = () => done(data.replace(/\r?\n$/, ''));
    stream.on('data', onData);
    stream.on('end', onEnd);
    stream.on('error', reject);
    stream.resume();
  });
}

function promptHidden(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stderr.write(question);
    let value = '';
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    const onData = (ch) => {
      if (ch === '\r' || ch === '\n' || ch === '\u0004') {
        stdin.setRawMode(false);
        stdin.off('data', onData);
        stdin.pause();
        process.stderr.write('\n');
        resolve(value);
      } else if (ch === '\u0003') {
        stdin.setRawMode(false);
        process.stderr.write('\n');
        process.exit(130);
      } else if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
      else value += ch;
    };
    stdin.on('data', onData);
    stdin.resume();
  });
}

/** The database password, or null when none was given and no terminal can ask. */
export async function getPassword(args) {
  if (process.env.SUPABASE_DB_PASSWORD) return process.env.SUPABASE_DB_PASSWORD;
  if (args['password-stdin'] === true) return (await readLine(process.stdin)) || null;
  if (process.stdin.isTTY && process.stderr.isTTY) {
    return (await promptHidden('Supabase database password (Project Settings → Database): ')) || null;
  }
  return null;
}

export const PASSWORD_HELP =
  'No database password. Set SUPABASE_DB_PASSWORD in the environment, pipe it with --password-stdin, or run in a terminal to be asked. Never put it in the command itself.';
