import { MEDIA_PROBE_PNG_BASE64 } from "@/lib/media/probe-image";
import { NextRequest, NextResponse } from "next/server";
import { authenticateSessionOrApiKey, unauthorizedResponse } from "@/lib/api/auth";
import { digest, mediaBase, mediaBucket, savePublicImage } from "@/lib/media/public-media";
import { mediaEnvironment } from "@/lib/media/runtime";

export async function GET(request: NextRequest) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  try {
    const env = mediaEnvironment();
    mediaBucket(env);
    if (!env.IMAGES) throw new Error("Image optimisation binding is missing");
    return NextResponse.json({ configured: true, ready: false, public_base: mediaBase(env, request.nextUrl.origin),
      message: "Run the POST probe and verify its public URL from outside this Worker before completing setup." });
  } catch (error) {
    return NextResponse.json({ configured: false, ready: false, error: error instanceof Error ? error.message : "Media configuration unavailable" }, { status: 503 });
  }
}
export async function POST(request: NextRequest) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  try {
    const env = mediaEnvironment();
    // Fixed 16x16 RGB PNG: validates the actual encoder and R2, with no AI generation.
    const png = Uint8Array.from(atob(MEDIA_PROBE_PNG_BASE64), (c) => c.charCodeAt(0)).buffer;
    const saved = await savePublicImage(env, png, "setup", request.nextUrl.origin, "probe");
    const object = await mediaBucket(env).get(saved.key);
    if (!object || await digest(await object.arrayBuffer()) !== saved.sha256) throw new Error("R2 readback differs from the uploaded image");
    return NextResponse.json({ ready: false, storage_verified: true, optimisation_verified: true,
      ...saved, message: "Fetch this URL externally and compare sha256 to complete public delivery verification." });
  } catch (error) {
    return NextResponse.json({ ready: false, error: error instanceof Error ? error.message : "Media probe failed" }, { status: 503 });
  }
}
