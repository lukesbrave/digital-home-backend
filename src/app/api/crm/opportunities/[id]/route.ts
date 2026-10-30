import { onDealWon } from "@/lib/money/engagements";
import { moneyDb } from "@/lib/money/db";
import { isDealWon } from "@/lib/money/state";
/**
 * PATCH  /api/crm/opportunities/[id] — move stage / set status / value
 * DELETE /api/crm/opportunities/[id]
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateSessionOrApiKey, unauthorizedResponse } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/crm/activity";
import { fireTrigger } from "@/lib/crm/engine";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const supabase = createAdminClient();
  const actor = auth.mode === "session" ? "human" : `agent:${auth.agent}`;

  const { data: opp } = await supabase.from("opportunities").select("*").eq("id", id).maybeSingle();
  if (!opp) return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });

  const updates: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) updates.name = body.name.trim();
  if ("value_cents" in body) updates.value_cents = Number(body.value_cents) || 0;
  if ("position" in body) updates.position = Number(body.position) || 0;

  let movedStage: { id: string; name: string } | null = null;
  if (body.stage_id && body.stage_id !== opp.stage_id) {
    const { data: stage } = await supabase
      .from("pipeline_stages")
      .select("id, name, pipeline_id")
      .eq("id", body.stage_id)
      .maybeSingle();
    if (!stage) return NextResponse.json({ error: "Stage not found" }, { status: 404 });
    updates.stage_id = stage.id;
    updates.pipeline_id = stage.pipeline_id;
    movedStage = stage;
  }

  let statusChange: "won" | "lost" | "open" | null = null;
  if (body.status && ["open", "won", "lost"].includes(body.status) && body.status !== opp.status) {
    statusChange = body.status;
    updates.status = body.status;
    if (body.status === "won") updates.won_at = new Date().toISOString();
    if (body.status === "lost") {
      updates.lost_at = new Date().toISOString();
      updates.lost_reason = body.lost_reason || null;
    }
  }

  if (Object.keys(updates).length === 0) return NextResponse.json({ opportunity: opp });

  const { data: updated, error } = await supabase
    .from("opportunities")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: lead } = await supabase.from("leads").select("*").eq("id", opp.lead_id).maybeSingle();

  if (lead && movedStage) {
    await logActivity(supabase, {
      lead_id: lead.id,
      activity_type: "stage_changed",
      title: `Moved to stage: ${movedStage.name}`,
      data: { opportunity_id: id, stage_id: movedStage.id },
      actor,
    });
    await fireTrigger(supabase, { type: "stage_changed", lead, data: { stage_id: movedStage.id } });
  }

  if (lead && statusChange) {
    await logActivity(supabase, {
      lead_id: lead.id,
      activity_type: "stage_changed",
      title:
        statusChange === "won"
          ? `Opportunity WON: ${updated.name}`
          : statusChange === "lost"
            ? `Opportunity lost: ${updated.name}${body.lost_reason ? ` — ${body.lost_reason}` : ""}`
            : `Opportunity reopened: ${updated.name}`,
      data: { opportunity_id: id, status: statusChange },
      actor,
    });
    if (statusChange === "won") {
      await supabase.from("leads").update({ status: "converted" }).eq("id", lead.id);
      await fireTrigger(
        supabase,
        { type: "status_changed", lead: { ...lead, status: "converted" }, data: { status: "converted" } }
      );
    }
  }

  if (isDealWon({ status: statusChange, stageName: movedStage?.name })) await onDealWon(moneyDb(supabase), { opportunityId: id, leadId: opp.lead_id, actor });
  return NextResponse.json({ opportunity: updated });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);

  const { id } = await params;
  const supabase = createAdminClient();
  const { error } = await supabase.from("opportunities").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: true });
}
