/**
 * POST /api/social/posts/[id]/publish — publish (or retry) right now.
 * Sets the post live in the queue and runs the engine inline for just this
 * post, so Instagram's transcode wait usually resolves within the request.
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateSessionOrApiKey, unauthorizedResponse } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { runSocialTick } from "@/lib/social/publisher";
import { scheduledAtForImmediateAttempt } from "@/lib/social/retry";

export const maxDuration = 300;

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await authenticateSessionOrApiKey(request, { allowRoles: ["admin", "social"] });
  if (!auth.authenticated) return unauthorizedResponse(auth.error);

  const { id } = await context.params;
  const supabase = createAdminClient();
  const { data: post } = await supabase.from("social_posts").select("*").eq("id", id).single();
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!["draft", "scheduled", "failed", "partial", "canceled"].includes(post.status)) {
    return NextResponse.json({ error: `Post is already ${post.status}` }, { status: 409 });
  }
  if (post.post_type === "carousel") {
    const { count: slideCount } = await supabase
      .from("social_post_media")
      .select("id", { count: "exact", head: true })
      .eq("post_id", id);
    if (!slideCount) {
      return NextResponse.json({ error: "Attach at least 1 photo before publishing" }, { status: 400 });
    }
  } else if (!post.video_url) {
    return NextResponse.json({ error: "Attach a video before publishing" }, { status: 400 });
  }
  const { count } = await supabase
    .from("social_post_targets")
    .select("*", { count: "exact", head: true })
    .eq("post_id", id);
  if (!count) {
    return NextResponse.json({ error: "Pick at least one platform account" }, { status: 400 });
  }

  // Re-arm failed targets on retry, then let the engine take it from here.
  await supabase
    .from("social_post_targets")
    .update({ status: "pending", error: null, platform_ref: {} })
    .eq("post_id", id)
    .eq("status", "failed");
  await supabase
    .from("social_posts")
    .update({
      status: "scheduled",
      scheduled_at: scheduledAtForImmediateAttempt(post, new Date().toISOString()),
      error: null,
    })
    .eq("id", id);

  const summary = await runSocialTick(supabase, { postId: id });
  const { data: fresh } = await supabase
    .from("social_posts")
    .select(
      "*, targets:social_post_targets(*, account:social_accounts(id, platform, name, username))"
    )
    .eq("id", id)
    .single();
  return NextResponse.json({ ok: true, summary, post: fresh });
}
