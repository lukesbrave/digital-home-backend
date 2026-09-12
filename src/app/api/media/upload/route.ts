import { NextRequest, NextResponse } from "next/server";
import { authenticateSessionOrApiKey, unauthorizedResponse } from "@/lib/api/auth";
import { MAX_INPUT_BYTES, savePublicImage } from "@/lib/media/public-media";
import { mediaEnvironment } from "@/lib/media/runtime";

export async function POST(request: NextRequest) {
  if (Number(request.headers.get("content-length")) > MAX_INPUT_BYTES * 1.4) {
    return NextResponse.json({ error: "Image upload is too large" }, { status: 413 });
  }
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  try {
    // JSON keeps machine signatures unambiguous; never accept a remote fetch URL.
    const { image_base64, slug, kind } = await request.json();
    if (typeof image_base64 !== "string" || image_base64.length > Math.ceil(MAX_INPUT_BYTES * 4 / 3) ||
        typeof slug !== "string" || !["blog", "website"].includes(kind)) {
      return NextResponse.json({ error: "Expected image_base64, slug and kind (blog or website)" }, { status: 400 });
    }
    const bytes = Uint8Array.from(atob(image_base64), (c) => c.charCodeAt(0)).buffer;
    const saved = await savePublicImage(mediaEnvironment(), bytes, slug, request.nextUrl.origin, kind);
    return NextResponse.json({ success: true, ...saved });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Image upload failed" }, { status: 422 });
  }
}
