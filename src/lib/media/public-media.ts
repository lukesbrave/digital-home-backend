/** Public marketing media only. Database records and private files stay separate. */
export const MAX_IMAGE_BYTES = 500 * 1024;
export const MAX_INPUT_BYTES = 20 * 1024 * 1024;
export const IMAGE_CACHE_CONTROL = "public, max-age=31536000, immutable";
export const MEDIA_PATH = "/media/";
export interface MediaEnvironment {
  PUBLIC_MEDIA?: R2Bucket;
  IMAGES?: ImagesBinding;
  PUBLIC_MEDIA_BASE?: string;
}
export function mediaBucket(env: MediaEnvironment): R2Bucket {
  if (!env.PUBLIC_MEDIA) throw new Error("Public image storage is not connected. Complete R2 setup before publishing images.");
  return env.PUBLIC_MEDIA;
}
export function mediaBase(env: MediaEnvironment, backendOrigin: string): string {
  const base = new URL(env.PUBLIC_MEDIA_BASE || `${backendOrigin}${MEDIA_PATH}`);
  if (base.username || base.password || base.search || base.hash ||
      (base.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(base.hostname)) ||
      base.hostname.endsWith(".r2.dev") || base.hostname.endsWith(".supabase.co") ||
      base.hostname.endsWith(".example.com") || base.hostname === "media.yourdomain.com") {
    throw new Error("Public image address must be a verified HTTPS media domain or the backend /media address.");
  }
  return base.href.replace(/\/$/, "");
}
export function mediaKeyValid(key: string): boolean {
  return /^public\/(blog|website|probe)\/[a-z0-9][a-z0-9-]{0,100}-[a-f0-9]{32}\.webp$/.test(key);
}
export async function digest(bytes: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((n) => n.toString(16).padStart(2, "0")).join("");
}
export async function optimiseImage(input: ArrayBuffer, images: ImagesBinding | undefined): Promise<ArrayBuffer> {
  if (!input.byteLength || input.byteLength > MAX_INPUT_BYTES) throw new Error("Image input must be between 1 byte and 20 MB.");
  if (!images) throw new Error("Image optimisation is unavailable. Check the IMAGES binding before publishing.");
  const info = await images.info(new Response(input).body!);
  if (!("width" in info) || !info.width || !info.height) throw new Error("Upload a raster image with valid dimensions.");
  // At most three encodes; never generate a second paid AI image to reduce size.
  for (const [width, quality] of [[1536, 78], [1280, 70], [1024, 62]]) {
    const stream = new Response(input).body!;
    const result = await images.input(stream)
      .transform({ width: Math.max(1, Math.round(info.width * Math.min(1, width / info.width, width / info.height))), fit: "scale-down" })
      .output({ format: "image/webp", quality });
    const bytes = await result.response().arrayBuffer();
    if (bytes.byteLength > 0 && bytes.byteLength <= MAX_IMAGE_BYTES &&
        new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
        new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP") return bytes;
  }
  throw new Error("Image remains above the 500 KB publishing limit after optimisation. Choose a simpler image or optimise it locally.");
}
export async function savePublicImage(
  env: MediaEnvironment, input: ArrayBuffer, slug: string, origin: string,
  kind: "blog" | "website" | "probe" = "blog",
): Promise<{ url: string; key: string; bytes: number; sha256: string }> {
  const bucket = mediaBucket(env);
  const base = mediaBase(env, origin);
  const bytes = await optimiseImage(input, env.IMAGES);
  const sha256 = await digest(bytes);
  const safeSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "image";
  const key = `public/${kind}/${safeSlug}-${sha256.slice(0, 32)}.webp`;
  const object = await bucket.put(key, bytes, {
    httpMetadata: { contentType: "image/webp", cacheControl: IMAGE_CACHE_CONTROL },
    customMetadata: { sha256, purpose: "public-marketing-image" },
  });
  if (!object || object.size !== bytes.byteLength) throw new Error("R2 image upload could not be verified.");
  return { key, url: `${base}/${key}`, bytes: bytes.byteLength, sha256 };
}

/** Runs before the dashboard auth gate, but exposes only our public image prefix. */
export async function servePublicMedia(request: Request, env: MediaEnvironment): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(MEDIA_PATH)) return null;
  if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  const key = url.pathname.slice(MEDIA_PATH.length);
  if (!mediaKeyValid(key)) return new Response(null, { status: 404 });
  if (!env.PUBLIC_MEDIA) return new Response(null, { status: 503, headers: { "Cache-Control": "no-store" } });
  const object = await env.PUBLIC_MEDIA.get(key);
  if (!object) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  const headers = new Headers({
    "Content-Type": "image/webp", "Cache-Control": IMAGE_CACHE_CONTROL,
    "Content-Length": String(object.size), "ETag": object.httpEtag,
    "X-Content-Type-Options": "nosniff", "Access-Control-Allow-Origin": "*",
  });
  if (request.headers.get("If-None-Match") === object.httpEtag) return new Response(null, { status: 304, headers });
  return new Response(request.method === "HEAD" ? null : object.body, { headers });
}
