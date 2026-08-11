/**
 * GET  /api/crm/leads — list/search leads
 *   ?q= (email/name/company search) &status= &tag= &email_status= &page= &limit= &sort=
 * POST /api/crm/leads — create a lead (fires triggers)
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateSessionOrApiKey, unauthorizedResponse } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { isValidEmail, upsertLead } from "@/lib/crm/leads";

export async function GET(request: NextRequest) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);

  const supabase = createAdminClient();
  const params = request.nextUrl.searchParams;

  const page = Math.max(1, Number(params.get("page") || 1));
  const limit = Math.min(100, Math.max(1, Number(params.get("limit") || 25)));
  const q = params.get("q")?.trim();
  const status = params.get("status");
  const tag = params.get("tag");
  const emailStatus = params.get("email_status");
  const sort = params.get("sort") || "created_at";
  const ascending = params.get("dir") === "asc";

  let query = supabase.from("leads").select("*", { count: "exact" });

  if (q) {
    const term = q.replace(/[%,()]/g, "");
    query = query.or(
      `email.ilike.%${term}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%,company.ilike.%${term}%`
    );
  }
  if (status) query = query.eq("status", status as "new" | "engaged" | "qualified" | "converted" | "lost");
  if (tag) query = query.contains("tags", [tag]);
  if (emailStatus) query = query.eq("email_status", emailStatus as "subscribed" | "unsubscribed" | "bounced" | "complained");

  const sortCol = ["last_activity_at", "created_at", "email", "score", "status"].includes(sort)
    ? sort
    : "created_at";

  const { data, count, error } = await query
    .order(sortCol, { ascending })
    .range((page - 1) * limit, page * limit - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    data: data || [],
    total: count || 0,
    page,
    limit,
    total_pages: Math.ceil((count || 0) / limit),
  });
}

export async function POST(request: NextRequest) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);

  const supabase = createAdminClient();
  const body = await request.json().catch(() => ({}));

  if (!isValidEmail(body.email || "")) {
    return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
  }

  try {
    const { lead, created } = await upsertLead(
      supabase,
      {
        email: body.email,
        name: body.name,
        first_name: body.first_name,
        last_name: body.last_name,
        phone: body.phone,
        company: body.company,
        source: body.source || "manual",
        tags: Array.isArray(body.tags) ? body.tags : [],
        custom: body.custom || {},
        message: body.message,
      },
      {
        actor: auth.mode === "session" ? "human" : `agent:${auth.agent}`,
        fireTriggers: body.fire_triggers !== false,
      }
    );
    return NextResponse.json({ lead, created }, { status: created ? 201 : 200 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "create failed" }, { status: 500 });
  }
}
