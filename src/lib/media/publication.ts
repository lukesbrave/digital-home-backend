import type { AdminClient } from "@/lib/crm/types";
import { MAX_IMAGE_BYTES, mediaBase, mediaBucket, mediaKeyValid } from "./public-media";
import { mediaEnvironment } from "./runtime";

/** Validate before changing draft status; never fetch an arbitrary supplied URL. */
export async function verifyPublicationImage(supabase: AdminClient, url: string | null | undefined, origin: string): Promise<void> {
  const { data, error } = await supabase.from("brand_context").select("content")
    .eq("category", "content").eq("key", "article_image_mode").maybeSingle();
  if (error) throw new Error("Could not verify the saved image preference");
  const mode = data?.content?.trim();
  if (mode !== "automatic" && mode !== "text_only") throw new Error("Record the article imagery preference before publishing");
  if (!url) {
    if (mode === "automatic") throw new Error("This article needs an image. Repair its existing draft before publishing, or explicitly choose text-only mode.");
    return;
  }
  const env = mediaEnvironment();
  const base = mediaBase(env, origin) + "/";
  if (!url.startsWith(base)) throw new Error("Move this article image to the configured R2 media address before publishing");
  const key = url.slice(base.length);
  if (!mediaKeyValid(key) || key.startsWith("public/probe/")) throw new Error("Invalid public article image address");
  const object = await mediaBucket(env).head(key);
  if (!object || object.size > MAX_IMAGE_BYTES || object.httpMetadata?.contentType !== "image/webp") {
    throw new Error("Article image is missing or fails the optimised image limit");
  }
}
