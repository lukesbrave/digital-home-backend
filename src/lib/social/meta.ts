/**
 * Meta Graph API client — Instagram Reels + Facebook Reels publishing and
 * insights. Both platforms ingest video by *pulling a hosted URL* (our public
 * social-videos bucket), then transcode asynchronously — so publishing is a
 * state machine the tick engine advances, not a single call.
 *
 * Auth model: a long-lived *page* access token per connected account
 * (obtained via OAuth or pasted from Graph API Explorer). Page tokens minted
 * from a long-lived user token do not expire.
 */
import type { MetricSnapshot, PublishStep } from "./types";

const GRAPH = "https://graph.facebook.com/v23.0";
const RUPLOAD = "https://rupload.facebook.com/video-upload/v23.0";

interface GraphError {
  error?: { message?: string; code?: number; error_user_msg?: string };
}

async function graph<T>(
  path: string,
  opts: { method?: "GET" | "POST"; token: string; params?: Record<string, string> }
): Promise<T> {
  const url = new URL(`${GRAPH}${path}`);
  url.searchParams.set("access_token", opts.token);
  const method = opts.method || "GET";
  let body: string | undefined;
  if (method === "GET") {
    for (const [k, v] of Object.entries(opts.params || {})) url.searchParams.set(k, v);
  } else {
    body = new URLSearchParams(opts.params || {}).toString();
  }
  const res = await fetch(url.toString(), {
    method,
    headers: method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : undefined,
    body,
  });
  const data = (await res.json().catch(() => ({}))) as T & GraphError;
  if (!res.ok || data.error) {
    const e = data.error;
    throw new Error(
      `Graph ${method} ${path}: ${e?.error_user_msg || e?.message || `HTTP ${res.status}`}${
        e?.code ? ` (code ${e.code})` : ""
      }`
    );
  }
  return data;
}

// ── OAuth / account discovery ────────────────────────────────────────────────

export function metaOAuthConfigured(): boolean {
  return Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET);
}

export function metaAuthorizeUrl(redirectUri: string, state: string): string {
  const url = new URL("https://www.facebook.com/v23.0/dialog/oauth");
  url.searchParams.set("client_id", process.env.META_APP_ID!);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  // We exchange server-side, and the business-login flow rejects the dialog's
  // default response_type=token outright.
  url.searchParams.set("response_type", "code");

  // Facebook Login for Business owns the asset + permission set in a login
  // configuration, so config_id replaces scope. Without it the classic scope
  // flow mints a token whose /me/accounts is empty for business-owned Pages —
  // the connect "succeeds" and finds nothing. Per-deployment: every brand runs
  // its own Meta app and its own configuration.
  const configId = process.env.META_LOGIN_CONFIG_ID;
  if (configId) {
    url.searchParams.set("config_id", configId);
    return url.toString();
  }

  url.searchParams.set(
    "scope",
    [
      "pages_show_list",
      "pages_read_engagement",
      "pages_manage_posts",
      "instagram_basic",
      "instagram_content_publish",
      "read_insights",
    ].join(",")
  );
  return url.toString();
}

export async function metaExchangeCode(code: string, redirectUri: string): Promise<string> {
  const url = new URL(`${GRAPH}/oauth/access_token`);
  url.searchParams.set("client_id", process.env.META_APP_ID!);
  url.searchParams.set("client_secret", process.env.META_APP_SECRET!);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code", code);
  const res = await fetch(url.toString());
  const data = (await res.json()) as { access_token?: string } & GraphError;
  if (!data.access_token) throw new Error(data.error?.message || "Code exchange failed");
  return data.access_token;
}

/** Short-lived user token → long-lived (~60d). Page tokens minted from it don't expire.
 *  System-user tokens (business login config, expiry "Never") are already long-lived and
 *  can't be exchanged, so fall back to the original rather than failing the connect. */
export async function metaLongLivedToken(userToken: string): Promise<string> {
  const url = new URL(`${GRAPH}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", process.env.META_APP_ID!);
  url.searchParams.set("client_secret", process.env.META_APP_SECRET!);
  url.searchParams.set("fb_exchange_token", userToken);
  const res = await fetch(url.toString());
  const data = (await res.json()) as { access_token?: string } & GraphError;
  return data.access_token || userToken;
}

export interface MetaPage {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: {
    id: string;
    username?: string;
    name?: string;
    profile_picture_url?: string;
  };
}

/** Pages the user manages, each with its page token + linked IG business account. */
export async function metaListPages(userToken: string): Promise<MetaPage[]> {
  const data = await graph<{ data: MetaPage[] }>("/me/accounts", {
    token: userToken,
    params: {
      fields:
        "id,name,access_token,instagram_business_account{id,username,name,profile_picture_url}",
      limit: "50",
    },
  });
  return data.data || [];
}

// ── Instagram Reels ──────────────────────────────────────────────────────────

/** Step 1: hand IG the hosted video URL; it downloads + transcodes async. */
export async function igCreateContainer(
  igUserId: string,
  pageToken: string,
  videoUrl: string,
  caption: string
): Promise<string> {
  const data = await graph<{ id: string }>(`/${igUserId}/media`, {
    method: "POST",
    token: pageToken,
    params: {
      media_type: "REELS",
      video_url: videoUrl,
      caption,
      share_to_feed: "true",
    },
  });
  return data.id;
}

/** Step 2 (repeated across ticks): is the container cooked yet? */
export async function igContainerStatus(
  containerId: string,
  pageToken: string
): Promise<{ code: string; detail?: string }> {
  const data = await graph<{ status_code?: string; status?: string }>(`/${containerId}`, {
    token: pageToken,
    params: { fields: "status_code,status" },
  });
  return { code: data.status_code || "UNKNOWN", detail: data.status };
}

/** Step 3: flip the finished container live. Returns the IG media id. */
export async function igPublishContainer(
  igUserId: string,
  pageToken: string,
  containerId: string
): Promise<string> {
  const data = await graph<{ id: string }>(`/${igUserId}/media_publish`, {
    method: "POST",
    token: pageToken,
    params: { creation_id: containerId },
  });
  return data.id;
}

export async function igMediaPermalink(mediaId: string, pageToken: string): Promise<string | null> {
  try {
    const data = await graph<{ permalink?: string }>(`/${mediaId}`, {
      token: pageToken,
      params: { fields: "permalink" },
    });
    return data.permalink || null;
  } catch {
    return null;
  }
}

/** Advance an in-flight IG publish one step. `ref` carries {container_id} between ticks. */
export async function igAdvance(
  igUserId: string,
  pageToken: string,
  ref: Record<string, unknown>
): Promise<PublishStep> {
  const containerId = ref.container_id as string;
  const status = await igContainerStatus(containerId, pageToken);
  if (status.code === "FINISHED") {
    const mediaId = await igPublishContainer(igUserId, pageToken, containerId);
    const permalink = await igMediaPermalink(mediaId, pageToken);
    return { state: "published", externalId: mediaId, externalUrl: permalink };
  }
  if (status.code === "ERROR" || status.code === "EXPIRED") {
    return { state: "failed", error: `IG container ${status.code}: ${status.detail || "processing failed"}` };
  }
  return { state: "processing", ref };
}

// ── Instagram image posts (single photo + carousels) ─────────────────────────

/** Single feed photo: one IMAGE container carrying the caption itself.
 *  Same status→publish walk as everything else, so igAdvance drives it. */
export async function igCreateImagePost(
  igUserId: string,
  pageToken: string,
  imageUrl: string,
  caption: string
): Promise<string> {
  const data = await graph<{ id: string }>(`/${igUserId}/media`, {
    method: "POST",
    token: pageToken,
    params: {
      image_url: imageUrl,
      caption,
    },
  });
  return data.id;
}

/** Carousel child: one image container. IG pulls the hosted URL (JPEG safest). */
export async function igCreateCarouselItem(
  igUserId: string,
  pageToken: string,
  imageUrl: string
): Promise<string> {
  const data = await graph<{ id: string }>(`/${igUserId}/media`, {
    method: "POST",
    token: pageToken,
    params: {
      image_url: imageUrl,
      is_carousel_item: "true",
    },
  });
  return data.id;
}

/** Parent CAROUSEL container over finished children. Same status→publish walk
 *  as Reels, so igAdvance drives it unchanged via {container_id}. */
export async function igCreateCarouselContainer(
  igUserId: string,
  pageToken: string,
  childIds: string[],
  caption: string
): Promise<string> {
  const data = await graph<{ id: string }>(`/${igUserId}/media`, {
    method: "POST",
    token: pageToken,
    params: {
      media_type: "CAROUSEL",
      children: childIds.join(","),
      caption,
    },
  });
  return data.id;
}

export async function igFetchMetrics(mediaId: string, pageToken: string): Promise<MetricSnapshot> {
  // Likes and comments live on the media object and need only instagram_basic,
  // so they keep working even when insights are unavailable. Reach/views/saves
  // come from /insights, which additionally requires instagram_manage_insights
  // — a missing scope there must not throw away the engagement numbers.
  const media = await graph<{ like_count?: number; comments_count?: number }>(`/${mediaId}`, {
    token: pageToken,
    params: { fields: "like_count,comments_count" },
  });

  let insights: Array<{ name: string; values?: Array<{ value?: number }> }> = [];
  let insightsError: string | null = null;
  try {
    const data = await graph<{
      data: Array<{ name: string; values?: Array<{ value?: number }> }>;
    }>(`/${mediaId}/insights`, {
      token: pageToken,
      params: { metric: "views,reach,saved,shares" },
    });
    insights = data.data || [];
  } catch (e) {
    insightsError = e instanceof Error ? e.message : String(e);
  }
  const get = (name: string) => insights.find((m) => m.name === name)?.values?.[0]?.value ?? 0;
  return {
    views: get("views"),
    likes: media.like_count ?? 0,
    comments: media.comments_count ?? 0,
    shares: get("shares"),
    saves: get("saved"),
    reach: get("reach"),
    raw: {
      insights,
      like_count: media.like_count,
      comments_count: media.comments_count,
      insights_error: insightsError,
    },
  };
}

// ── Facebook Reels ───────────────────────────────────────────────────────────

/**
 * Start the upload session, then point rupload at our hosted file — Meta
 * pulls it server-side (no bytes proxied through the worker) — then finish
 * with the caption. Processing continues async; igAdvance-style polling
 * happens via fbAdvance.
 */
export async function fbStartReel(
  pageId: string,
  pageToken: string,
  videoUrl: string
): Promise<string> {
  const start = await graph<{ video_id: string; upload_url: string }>(`/${pageId}/video_reels`, {
    method: "POST",
    token: pageToken,
    params: { upload_phase: "start" },
  });

  const uploadRes = await fetch(`${RUPLOAD}/${start.video_id}`, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${pageToken}`,
      file_url: videoUrl,
    },
  });
  const uploadData = (await uploadRes.json().catch(() => ({}))) as {
    success?: boolean;
  } & GraphError;
  if (!uploadRes.ok || !uploadData.success) {
    throw new Error(
      `FB reel upload failed: ${uploadData.error?.message || `HTTP ${uploadRes.status}`}`
    );
  }
  return start.video_id;
}

export async function fbFinishReel(
  pageId: string,
  pageToken: string,
  videoId: string,
  description: string
): Promise<void> {
  await graph(`/${pageId}/video_reels`, {
    method: "POST",
    token: pageToken,
    params: {
      upload_phase: "finish",
      video_id: videoId,
      video_state: "PUBLISHED",
      description,
    },
  });
}

/** Advance an in-flight FB publish. `ref` carries {video_id, finished?} between ticks. */
export async function fbAdvance(
  pageId: string,
  pageToken: string,
  ref: Record<string, unknown>
): Promise<PublishStep> {
  const videoId = ref.video_id as string;
  const data = await graph<{
    status?: { video_status?: string; processing_phase?: { status?: string } };
    permalink_url?: string;
  }>(`/${videoId}`, {
    token: pageToken,
    params: { fields: "status,permalink_url" },
  });
  const videoStatus = data.status?.video_status;
  if (videoStatus === "ready") {
    const url = data.permalink_url
      ? data.permalink_url.startsWith("http")
        ? data.permalink_url
        : `https://www.facebook.com${data.permalink_url}`
      : null;
    return { state: "published", externalId: videoId, externalUrl: url };
  }
  if (videoStatus === "error") {
    return { state: "failed", error: "Facebook reported a processing error for this reel" };
  }
  return { state: "processing", ref };
}

// ── Facebook multi-photo posts (carousel analogue) ───────────────────────────

/**
 * Facebook has no CAROUSEL media type for organic page posts — the analogue is
 * a multi-photo feed post: upload each image unpublished, then create one feed
 * post with attached_media. Photos ingest synchronously (no transcode), so
 * this completes in a single publish step — no fbAdvance needed.
 */
export async function fbPublishPhotoPost(
  pageId: string,
  pageToken: string,
  imageUrls: string[],
  caption: string
): Promise<{ postId: string; permalink: string | null }> {
  const photoIds: string[] = [];
  for (const url of imageUrls) {
    const photo = await graph<{ id: string }>(`/${pageId}/photos`, {
      method: "POST",
      token: pageToken,
      params: { url, published: "false" },
    });
    photoIds.push(photo.id);
  }

  const params: Record<string, string> = { message: caption };
  photoIds.forEach((id, i) => {
    params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id });
  });
  const post = await graph<{ id: string }>(`/${pageId}/feed`, {
    method: "POST",
    token: pageToken,
    params,
  });

  let permalink: string | null = null;
  try {
    const data = await graph<{ permalink_url?: string }>(`/${post.id}`, {
      token: pageToken,
      params: { fields: "permalink_url" },
    });
    permalink = data.permalink_url || null;
  } catch {
    // permalink is a nicety; the post id is what matters
  }
  return { postId: post.id, permalink };
}

/** Metrics for a multi-photo feed post (carousel) — video_insights doesn't exist here. */
export async function fbFetchPostMetrics(
  postId: string,
  pageToken: string
): Promise<MetricSnapshot> {
  // post_impressions / post_impressions_unique were RETIRED from the Graph API
  // — asking for them fails the entire call with (#100), which is what left
  // Facebook with no metrics at all. Only request metrics that still exist.
  let insights: Array<{ name: string; values?: Array<{ value?: unknown }> }> = [];
  let insightsError: string | null = null;
  try {
    const data = await graph<{
      data: Array<{ name: string; values?: Array<{ value?: unknown }> }>;
    }>(`/${postId}/insights`, {
      token: pageToken,
      params: { metric: "post_reactions_by_type_total,post_clicks" },
    });
    insights = data.data || [];
  } catch (e) {
    insightsError = e instanceof Error ? e.message : String(e);
  }
  const val = (name: string) => insights.find((m) => m.name === name)?.values?.[0]?.value;
  const reactions = (val("post_reactions_by_type_total") || {}) as Record<string, unknown>;
  const reactionTotal = Object.values(reactions).reduce<number>(
    (sum, n) => sum + (Number(n) || 0),
    0
  );

  // Comment and share counts sit on the post object behind
  // pages_read_engagement — tolerate losing them rather than the whole snapshot.
  let engagement: {
    comments?: { summary?: { total_count?: number } };
    shares?: { count?: number };
  } = {};
  let engagementError: string | null = null;
  try {
    engagement = await graph(`/${postId}`, {
      token: pageToken,
      params: { fields: "comments.summary(true).limit(0),shares" },
    });
  } catch (e) {
    engagementError = e instanceof Error ? e.message : String(e);
  }

  return {
    views: 0,
    likes: reactionTotal,
    comments: engagement.comments?.summary?.total_count ?? 0,
    shares: engagement.shares?.count ?? 0,
    saves: 0,
    reach: 0,
    raw: {
      insights,
      clicks: val("post_clicks") ?? 0,
      insights_error: insightsError,
      engagement_error: engagementError,
    },
  };
}

export async function fbFetchMetrics(videoId: string, pageToken: string): Promise<MetricSnapshot> {
  // Reels expose plays and social actions through video_insights, while
  // likes/comments ride the video object. Keep those requests independent:
  // Meta retires individual insight names without preserving compatibility,
  // and one invalid name makes an otherwise valid combined request fail.
  type VideoInsight = { name: string; values?: Array<{ value?: unknown }> };
  type VideoInsightResponse = { video_insights?: { data?: VideoInsight[] } };
  type EngagementResponse = {
    likes?: { summary?: { total_count?: number } };
    comments?: { summary?: { total_count?: number } };
  };

  async function attempt<T>(request: Promise<T>): Promise<{ data: T | null; error: string | null }> {
    try {
      return { data: await request, error: null };
    } catch (error) {
      return { data: null, error: error instanceof Error ? error.message : String(error) };
    }
  }

  const [playsResult, actionsResult, engagementResult] = await Promise.all([
    attempt(
      graph<VideoInsightResponse>(`/${videoId}`, {
        token: pageToken,
        params: { fields: "video_insights.metric(blue_reels_play_count){name,values}" },
      })
    ),
    attempt(
      graph<VideoInsightResponse>(`/${videoId}`, {
        token: pageToken,
        params: { fields: "video_insights.metric(post_video_social_actions){name,values}" },
      })
    ),
    attempt(
      graph<EngagementResponse>(`/${videoId}`, {
        token: pageToken,
        params: { fields: "likes.summary(true).limit(0),comments.summary(true).limit(0)" },
      })
    ),
  ]);

  if (!playsResult.data && !actionsResult.data && !engagementResult.data) {
    throw new Error(
      `Facebook Reel metrics unavailable: ${[
        playsResult.error,
        actionsResult.error,
        engagementResult.error,
      ]
        .filter(Boolean)
        .join(" | ")}`
    );
  }

  const insights = [
    ...(playsResult.data?.video_insights?.data || []),
    ...(actionsResult.data?.video_insights?.data || []),
  ];
  const value = (name: string) => insights.find((metric) => metric.name === name)?.values?.[0]?.value;
  const plays = Number(value("blue_reels_play_count")) || 0;
  const socialActions = value("post_video_social_actions");
  const shares =
    socialActions && typeof socialActions === "object"
      ? Number(
          (socialActions as Record<string, unknown>).share ??
            (socialActions as Record<string, unknown>).shares ??
            0
        ) || 0
      : 0;

  return {
    views: plays,
    likes: engagementResult.data?.likes?.summary?.total_count ?? 0,
    comments: engagementResult.data?.comments?.summary?.total_count ?? 0,
    shares,
    saves: 0,
    // Meta retired post_impressions_unique from Graph v23. Do not substitute
    // plays for reach: they describe different things.
    reach: 0,
    raw: {
      insights,
      likes: engagementResult.data?.likes?.summary,
      comments: engagementResult.data?.comments?.summary,
      errors: {
        plays: playsResult.error,
        social_actions: actionsResult.error,
        engagement: engagementResult.error,
      },
      reach_unavailable: true,
    },
  };
}

// ── Token validation (manual connect path) ───────────────────────────────────

/** Sanity-check a pasted page token and read back who it belongs to. */
export async function metaDebugPageToken(
  pageToken: string
): Promise<{ pageId: string; pageName: string; igAccount: MetaPage["instagram_business_account"] | null }> {
  const me = await graph<{
    id: string;
    name: string;
    instagram_business_account?: MetaPage["instagram_business_account"];
  }>("/me", {
    token: pageToken,
    params: { fields: "id,name,instagram_business_account{id,username,name,profile_picture_url}" },
  });
  return { pageId: me.id, pageName: me.name, igAccount: me.instagram_business_account || null };
}
