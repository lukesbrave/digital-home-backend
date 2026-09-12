import { verifyPublicationImage } from "@/lib/media/publication";
/**
 * GET  /api/articles — List all articles (content_objects)
 * POST /api/articles — Create an article draft (content_objects row)
 *
 * Query params (GET):
 *   ?status=draft|published|archived
 *   ?search=keyword
 *   ?page=1&limit=50
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticateSessionOrApiKey, unauthorizedResponse } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import type { Enums } from "@/types/database";


export async function GET(request: NextRequest) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);

  const { searchParams } = request.nextUrl;
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "50");
  const offset = (page - 1) * limit;

  const supabase = createAdminClient();
  let query = supabase
    .from("content_objects")
    .select("*, seo_meta(*)", { count: "exact" });

  // Filter by status
  const status = searchParams.get("status");
  if (status) {
    query = query.eq("status", status as "published" | "draft" | "archived");
  }

  // Search by title
  const search = searchParams.get("search");
  if (search) {
    query = query.ilike("title", `%${search}%`);
  }

  // Order and paginate
  query = query
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    articles: data || [],
    total: count || 0,
    page,
    limit,
  });
}

/**
 * POST /api/articles — Create an article draft.
 *
 * Auth: operator session OR machine `x-api-key`. Agent writes default to
 * `created_by: "content_agent"` and `status: "draft"`. Pass `seo` to create a
 * linked seo_meta row in the same call. To publish, link this row to a
 * content_calendar entry and call POST /api/publish (or set status here).
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);

  const body = await request.json().catch(() => null);
  if (!body || !body.slug || !body.title) {
    return NextResponse.json({ error: "slug and title are required" }, { status: 400 });
  }

  const supabase = createAdminClient();

  if (body.status === "published") {
    try {
      await verifyPublicationImage(supabase, body.featured_image_url, request.nextUrl.origin);
      if (body.seo?.og_image_url) await verifyPublicationImage(supabase, body.seo.og_image_url, request.nextUrl.origin);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Image validation failed" }, { status: 409 });
    }
  }

  // Optionally create a linked seo_meta row first.
  let seoMetaId: string | undefined = (body.seo_meta_id as string | undefined) ?? undefined;
  if (body.seo && !seoMetaId) {
    const seo = body.seo as Record<string, unknown>;
    const { data: seoData, error: seoError } = await supabase
      .from("seo_meta")
      .insert({
        title: (seo.title as string | undefined) ?? body.title,
        description: (seo.description as string | undefined) ?? body.excerpt ?? null,
        canonical_url: (seo.canonical_url as string | undefined) ?? null,
        og_image_url: (seo.og_image_url as string | undefined) ?? body.featured_image_url ?? null,
        schema_type: (seo.schema_type as string | undefined) ?? "Article",
        target_keyword: (seo.target_keyword as string | undefined) ?? null,
        secondary_keywords: (seo.secondary_keywords as string[] | undefined) ?? [],
        keyword_cluster: (seo.keyword_cluster as string | undefined) ?? null,
      })
      .select("id")
      .single();
    if (seoError) {
      return NextResponse.json(
        { error: `SEO meta creation failed: ${seoError.message}` },
        { status: 500 }
      );
    }
    seoMetaId = seoData.id;
  }

  const status = (body.status as Enums<"content_status"> | undefined) ?? "draft";
  const defaultCreator: Enums<"content_creator"> =
    auth.mode === "api-key" ? "content_agent" : "human";

  const { data, error } = await supabase
    .from("content_objects")
    .insert({
      slug: body.slug as string,
      title: body.title as string,
      subtitle: (body.subtitle as string | undefined) ?? undefined,
      content_type: (body.content_type as Enums<"content_type"> | undefined) ?? "article",
      body: (body.body as string | undefined) ?? undefined,
      excerpt: (body.excerpt as string | undefined) ?? undefined,
      semantic_tags: (body.semantic_tags as string[] | undefined) ?? [],
      associated_offers: (body.associated_offers as string[] | undefined) ?? [],
      target_segments: (body.target_segments as string[] | undefined) ?? [],
      seo_meta_id: seoMetaId,
      featured_image_url: (body.featured_image_url as string | undefined) ?? undefined,
      featured_video_url: (body.featured_video_url as string | undefined) ?? undefined,
      status,
      created_by: (body.created_by as Enums<"content_creator"> | undefined) ?? defaultCreator,
      author_name: (body.author_name as string | undefined) ?? undefined,
      published_at: status === "published" ? new Date().toISOString() : undefined,
    })
    .select("*, seo_meta(*)")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Duplicate: an article with that slug already exists" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ article: data }, { status: 201 });
}
