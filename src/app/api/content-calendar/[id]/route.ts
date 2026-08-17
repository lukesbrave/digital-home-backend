import { NextRequest, NextResponse } from "next/server";
import { authenticateSessionOrApiKey, unauthorizedResponse } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

const VALID_TRANSITIONS: Record<string, string[]> = {
  planned: ["approved", "archived"],
  approved: ["planned", "writing", "archived"],
  writing: ["approved", "draft", "published", "archived"],
  draft: ["published", "archived"],
  published: ["draft", "archived"],
  archived: ["planned"],
};

const CONTENT_OBJECT_STATUSES = ["draft", "published", "archived"] as const;

function isContentObjectStatus(
  status: unknown
): status is (typeof CONTENT_OBJECT_STATUSES)[number] {
  return typeof status === "string" && CONTENT_OBJECT_STATUSES.includes(
    status as (typeof CONTENT_OBJECT_STATUSES)[number]
  );
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);

  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const supabase = createAdminClient();

  const allowedFields = [
    "title",
    "search_query",
    "target_keyword",
    "keyword_cluster",
    "intent_type",
    "priority",
    "status",
    "pillar_topic",
    "topic_cluster",
    "scheduled_publish_date",
    "content_object_id",
    "seo_meta_id",
    "run_id",
    "notes",
  ] as const;

  const update: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      update[field] = body[field];
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  let contentRollback:
    | { id: string; status: (typeof CONTENT_OBJECT_STATUSES)[number]; published_at: string | null }
    | null = null;

  if (typeof update.status === "string") {
    const { data: current, error: currentError } = await supabase
      .from("content_calendar")
      .select("status, content_object_id")
      .eq("id", id)
      .single();

    if (currentError || !current) {
      return NextResponse.json({ error: "Calendar entry not found" }, { status: 404 });
    }

    const allowed = VALID_TRANSITIONS[current.status] || [];
    if (!allowed.includes(update.status)) {
      return NextResponse.json(
        {
          error: `Cannot transition from '${current.status}' to '${update.status}'`,
        },
        { status: 422 }
      );
    }

    // A written article has two linked workflow rows. Keep the public-facing
    // content object in lockstep with board moves such as Published -> Draft;
    // the Digital Home reads content_objects, not content_calendar.
    if (current.content_object_id && isContentObjectStatus(update.status)) {
      const { data: contentObject, error: contentReadError } = await supabase
        .from("content_objects")
        .select("id, status, published_at")
        .eq("id", current.content_object_id)
        .single();

      if (contentReadError || !contentObject) {
        return NextResponse.json(
          { error: `Linked article not found: ${contentReadError?.message || "not found"}` },
          { status: contentReadError ? 500 : 404 }
        );
      }

      const contentUpdate: {
        status: (typeof CONTENT_OBJECT_STATUSES)[number];
        published_at?: string;
      } = { status: update.status };

      if (update.status === "published" && !contentObject.published_at) {
        contentUpdate.published_at = new Date().toISOString();
      }

      const { error: contentUpdateError } = await supabase
        .from("content_objects")
        .update(contentUpdate)
        .eq("id", contentObject.id);

      if (contentUpdateError) {
        return NextResponse.json(
          { error: `Could not sync linked article status: ${contentUpdateError.message}` },
          { status: 500 }
        );
      }

      contentRollback = {
        id: contentObject.id,
        status: contentObject.status,
        published_at: contentObject.published_at,
      };
    }
  }

  const { data, error } = await supabase
    .from("content_calendar")
    .update(update)
    .eq("id", id)
    .select("*, content_objects:content_object_id(slug, status, published_at)")
    .single();

  if (error || !data) {
    // The linked article is updated first so an unpublish cannot leave public
    // content live. Restore it if the calendar write unexpectedly fails.
    if (contentRollback) {
      await supabase
        .from("content_objects")
        .update({
          status: contentRollback.status,
          published_at: contentRollback.published_at,
        })
        .eq("id", contentRollback.id);
    }

    return NextResponse.json(
      { error: error?.message || "Calendar entry not found" },
      { status: error ? 500 : 404 }
    );
  }

  return NextResponse.json(data);
}
