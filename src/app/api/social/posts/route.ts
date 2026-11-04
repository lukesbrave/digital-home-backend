/**
 * GET  /api/social/posts — list posts with their per-platform targets,
 *      accounts, and latest metrics snapshot per target.
 * POST /api/social/posts — create a post (draft or scheduled) with targets.
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateSessionOrApiKey, unauthorizedResponse } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import {
  CAROUSEL_MAX_SLIDES,
  CAROUSEL_MIN_SLIDES,
  CAROUSEL_PLATFORMS,
} from "@/lib/social/types";

export async function GET(request: NextRequest) {
  const auth = await authenticateSessionOrApiKey(request, { allowRoles: ["admin", "social"] });
  if (!auth.authenticated) return unauthorizedResponse(auth.error);

  const { searchParams } = request.nextUrl;
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "100", 10)));
  const status = searchParams.get("status");
  const from = searchParams.get("from"); // ISO — scheduled_at window for the calendar
  const to = searchParams.get("to");

  const supabase = createAdminClient();
  let query = supabase
    .from("social_posts")
    .select(
      "*, targets:social_post_targets(*, account:social_accounts(id, platform, name, username)), media:social_post_media(*)"
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (status) query = query.eq("status", status as never);
  if (from) query = query.gte("scheduled_at", from);
  if (to) query = query.lte("scheduled_at", to);

  const { data: posts, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Latest snapshot per target, batched in one query.
  const targetIds = (posts || []).flatMap((p) => (p.targets || []).map((t: { id: string }) => t.id));
  const latestByTarget: Record<string, unknown> = {};
  if (targetIds.length) {
    const { data: metrics } = await supabase
      .from("social_metrics")
      .select("target_id, captured_at, views, likes, comments, shares, saves, reach")
      .in("target_id", targetIds)
      .order("captured_at", { ascending: false });
    for (const m of metrics || []) {
      if (!latestByTarget[m.target_id]) latestByTarget[m.target_id] = m;
    }
  }

  return NextResponse.json({
    posts: (posts || []).map((p) => ({
      ...p,
      media: [...(p.media || [])].sort(
        (a: { position: number }, b: { position: number }) => a.position - b.position
      ),
      targets: (p.targets || []).map((t: { id: string }) => ({
        ...t,
        latest_metrics: latestByTarget[t.id] || null,
      })),
    })),
  });
}

export async function POST(request: NextRequest) {
  const auth = await authenticateSessionOrApiKey(request, { allowRoles: ["admin", "social"] });
  if (!auth.authenticated) return unauthorizedResponse(auth.error);

  const body = (await request.json().catch(() => null)) as {
    title?: string;
    caption?: string;
    post_type?: "video" | "carousel";
    video_path?: string;
    video_url?: string;
    thumbnail_url?: string;
    media?: Array<{ url: string; path?: string | null; kind?: "image" | "video" }>;
    scheduled_at?: string;
    account_ids?: string[];
    status?: "draft" | "scheduled";
  } | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const status = body.status === "scheduled" ? "scheduled" : "draft";
  const postType = body.post_type === "carousel" ? "carousel" : "video";
  const accountIds = Array.isArray(body.account_ids) ? body.account_ids : [];
  const media = Array.isArray(body.media)
    ? body.media.filter((m) => typeof m?.url === "string" && m.url)
    : [];

  if (postType === "carousel" && media.length > CAROUSEL_MAX_SLIDES) {
    return NextResponse.json(
      { error: `A carousel takes at most ${CAROUSEL_MAX_SLIDES} slides (Instagram's cap)` },
      { status: 400 }
    );
  }

  if (status === "scheduled") {
    if (postType === "video" && !body.video_url) {
      return NextResponse.json({ error: "A video is required to schedule" }, { status: 400 });
    }
    if (postType === "carousel" && media.length < CAROUSEL_MIN_SLIDES) {
      return NextResponse.json(
        { error: "An image post needs at least 1 slide to schedule" },
        { status: 400 }
      );
    }
    if (!body.scheduled_at) {
      return NextResponse.json({ error: "scheduled_at is required to schedule" }, { status: 400 });
    }
    if (accountIds.length === 0) {
      return NextResponse.json({ error: "Pick at least one platform account" }, { status: 400 });
    }
  }

  const supabase = createAdminClient();

  let accounts: Array<{ id: string; platform: "instagram" | "facebook" | "youtube" }> = [];
  if (accountIds.length) {
    const { data, error } = await supabase
      .from("social_accounts")
      .select("id, platform")
      .in("id", accountIds)
      .eq("status", "active");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if(data?.some(a=>!["instagram","facebook","youtube"].includes(a.platform)))return NextResponse.json({error:"Unsupported connected platform"},{status:400});
    accounts = (data || []) as typeof accounts;
    if (accounts.length !== accountIds.length) {
      return NextResponse.json({ error: "One or more accounts are not connected" }, { status: 400 });
    }
    if (postType === "carousel") {
      const invalid = accounts.filter(
        (a) => !CAROUSEL_PLATFORMS.includes(a.platform)
      );
      if (invalid.length) {
        return NextResponse.json(
          { error: "Image posts publish to Instagram and Facebook only — drop the YouTube account" },
          { status: 400 }
        );
      }
    }
  }

  const { data: post, error: postError } = await supabase
    .from("social_posts")
    .insert({
      title: body.title?.trim() || null,
      caption: body.caption || "",
      post_type: postType,
      video_path: postType === "video" ? body.video_path || null : null,
      video_url: postType === "video" ? body.video_url || null : null,
      thumbnail_url: body.thumbnail_url || null,
      status,
      scheduled_at: body.scheduled_at || null,
      created_by: auth.mode === "api-key" ? auth.agent : "human",
    })
    .select()
    .single();
  if (postError || !post) {
    return NextResponse.json({ error: postError?.message || "Insert failed" }, { status: 500 });
  }

  if (postType === "carousel" && media.length) {
    const { error: mediaError } = await supabase.from("social_post_media").insert(
      media.map((m, i) => ({
        post_id: post.id,
        position: i,
        kind: m.kind === "video" ? ("video" as const) : ("image" as const),
        path: m.path || null,
        url: m.url,
      }))
    );
    if (mediaError) {
      await supabase.from("social_posts").delete().eq("id", post.id);
      return NextResponse.json({ error: mediaError.message }, { status: 500 });
    }
  }

  if (accounts.length) {
    const { error: targetsError } = await supabase.from("social_post_targets").insert(
      accounts.map((a) => ({ post_id: post.id, account_id: a.id, platform: a.platform }))
    );
    if (targetsError) {
      await supabase.from("social_posts").delete().eq("id", post.id);
      return NextResponse.json({ error: targetsError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ post }, { status: 201 });
}
