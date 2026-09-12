import { createHash, createHmac } from 'node:crypto';
const base = process.argv[process.argv.indexOf('--base') + 1];
if (!process.argv.includes('--base') || !base?.startsWith('https://')) throw new Error('Pass --base with the verified HTTPS backend URL');
const secret = process.env.API_SECRET_KEY;
if (!secret) throw new Error('API_SECRET_KEY missing from the owner-only environment');
const path = '/api/media/readiness';
const body = '{}';
const timestamp = String(Math.floor(Date.now() / 1000));
const signature = createHmac('sha256', process.env.API_REQUEST_SIGNING_SECRET || secret)
  .update(`POST:${path}:${timestamp}:${body}`).digest('hex');
const probe = await fetch(new URL(path, base), { method: 'POST', redirect: 'error',
  headers: { 'Content-Type': 'application/json', 'x-api-key': secret, 'x-timestamp': timestamp, 'x-signature': signature }, body });
if (!probe.ok) throw new Error(`Media probe failed (${probe.status}): ${await probe.text()}`);
const result = await probe.json();
if (!result.storage_verified || !result.optimisation_verified || !result.url || !result.sha256) throw new Error('Incomplete media probe receipt');
const url = new URL(result.url);
if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid public URL');
const image = await fetch(url, { redirect: 'error' });
const bytes = Buffer.from(await image.arrayBuffer());
if (!image.ok || image.headers.get('content-type') !== 'image/webp' ||
    !image.headers.get('cache-control')?.includes('immutable') || bytes.length > 500 * 1024 ||
    bytes.length !== result.bytes || createHash('sha256').update(bytes).digest('hex') !== result.sha256) {
  throw new Error('Public image delivery failed byte/type/cache verification');
}
console.log(JSON.stringify({ ready: true, url: result.url, bytes: bytes.length, sha256: result.sha256,
  storage_verified: true, optimisation_verified: true, public_delivery_verified: true }, null, 2));
