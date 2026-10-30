import { onDealWon } from "@/lib/money/engagements";
import { moneyDb } from "@/lib/money/db";
import { isDealWon } from "@/lib/money/state";
/**
 * GET  /api/crm/opportunities?pipeline_id=&status= — board data (joined leads)
 * POST /api/crm/opportunities — { lead_id, stage_id, name?, value_cents? }
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateSessionOrApiKey, unauthorizedResponse } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/crm/activity";
import { fireTrigger } from "@/lib/crm/engine";

export async function GET(request: NextRequest) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);

  const supabase = createAdminClient();
  const params = request.nextUrl.searchParams;

  let query = supabase
    .from("opportunities")
    .select("*, leads(id, email, first_name, last_name, company, tags, status)")
    .order("position")
    .order("created_at", { ascending: false });

  if (params.get("pipeline_id")) query = query.eq("pipeline_id", params.get("pipeline_id")!);
  const status = params.get("status");
  if (status) query = query.eq("status", status as "open" | "won" | "lost");

  const { data, error } = await query.limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ opportunities: data || [] });
}

export async function POST(request: NextRequest) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);

  const body = await request.json().catch(() => ({}));
  if (!body.lead_id || !body.stage_id) {
    return NextResponse.json({ error: "lead_id and stage_id are required" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const [{ data: lead }, { data: stage }] = await Promise.all([
    supabase.from("leads").select("*").eq("id", body.lead_id).maybeSingle(),
    supabase.from("pipeline_stages").select("*").eq("id", body.stage_id).maybeSingle(),
  ]);
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  if (!stage) return NextResponse.json({ error: "Stage not found" }, { status: 404 });

  const name =
    (typeof body.name === "string" && body.name.trim()) ||
    [lead.first_name, lead.last_name].filter(Boolean).join(" ") ||
    lead.email;

  const { data, error } = await supabase
    .from("opportunities")
    .insert({
      lead_id: lead.id,
      pipeline_id: stage.pipeline_id,
      stage_id: stage.id,
      name,
      value_cents: Number(body.value_cents) || 0,
      currency: body.currency || "AUD",
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logActivity(supabase, {
    lead_id: lead.id,
    activity_type: "stage_changed",
    title: `Opportunity created in stage: ${stage.name}`,
    data: { opportunity_id: data.id, stage_id: stage.id },
    actor: auth.mode === "session" ? "human" : `agent:${auth.agent}`,
  });
  await fireTrigger(supabase, { type: "stage_changed", lead, data: { stage_id: stage.id } });

  if (isDealWon({ stageName: stage.name })) await onDealWon(moneyDb(supabase), { opportunityId: data.id, leadId: lead.id, actor: auth.mode === "session" ? "human" : `agent:${auth.agent}` });
  return NextResponse.json({ opportunity: data }, { status: 201 });
}
