/** GET /api/crm/dashboard — overview counts + recent activity for the CRM home */
import { NextRequest, NextResponse } from "next/server";
import { authenticateSessionOrApiKey, unauthorizedResponse } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);

  const supabase = createAdminClient();
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const [
    totalLeads,
    newThisWeek,
    activeEnrollments,
    emails7d,
    openTasks,
    upcomingAppointments,
    recentActivities,
    openOpps,
    wonOpps,
  ] = await Promise.all([
    supabase.from("leads").select("id", { count: "exact", head: true }),
    supabase.from("leads").select("id", { count: "exact", head: true }).gte("created_at", weekAgo),
    supabase
      .from("workflow_enrollments")
      .select("id", { count: "exact", head: true })
      .eq("status", "active"),
    supabase
      .from("email_sends")
      .select("id", { count: "exact", head: true })
      .gte("created_at", weekAgo)
      .in("status", ["sent", "simulated"]),
    supabase.from("crm_tasks").select("id", { count: "exact", head: true }).eq("status", "open"),
    supabase
      .from("appointments")
      .select("*, leads(id, email, first_name, last_name)")
      .gte("starts_at", new Date().toISOString())
      .order("starts_at")
      .limit(5),
    supabase
      .from("lead_activities")
      .select("*, leads(id, email, first_name, last_name)")
      .order("created_at", { ascending: false })
      .limit(25),
    supabase
      .from("opportunities")
      .select("value_cents, stage_id", { count: "exact" })
      .eq("status", "open"),
    supabase
      .from("opportunities")
      .select("value_cents, won_at")
      .eq("status", "won")
      .limit(2000),
  ]);

  const pipelineValueCents = (openOpps.data || []).reduce((sum, o) => sum + (o.value_cents || 0), 0);

  // Pipeline forecast: open deals with no value contribute their stage's
  // estimate from backend_settings `crm_stage_estimates` —
  // { default_cents, stages: { "Stage name": cents } } — so an auto-filed
  // pipeline reads as a forecast instead of a misleading $0.
  let pipelineEstimateCents = pipelineValueCents;
  const { data: estCfg } = await supabase
    .from("backend_settings")
    .select("value")
    .eq("key", "crm_stage_estimates")
    .maybeSingle();
  const estConf = (estCfg?.value ?? {}) as { default_cents?: number; stages?: Record<string, number> };
  if (estConf.default_cents || estConf.stages) {
    const { data: stageRows } = await supabase.from("pipeline_stages").select("id, name");
    const stageNameById = new Map((stageRows ?? []).map((s) => [s.id, s.name]));
    for (const o of openOpps.data || []) {
      if (o.value_cents) continue;
      const stageName = stageNameById.get(o.stage_id) ?? "";
      pipelineEstimateCents += estConf.stages?.[stageName] ?? estConf.default_cents ?? 0;
    }
  }

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  let wonTotalCents = 0;
  let wonMonthCents = 0;
  for (const o of wonOpps.data || []) {
    wonTotalCents += o.value_cents || 0;
    if (o.won_at && new Date(o.won_at) >= monthStart) wonMonthCents += o.value_cents || 0;
  }

  return NextResponse.json({
    counts: {
      total_leads: totalLeads.count || 0,
      new_this_week: newThisWeek.count || 0,
      active_enrollments: activeEnrollments.count || 0,
      emails_7d: emails7d.count || 0,
      open_tasks: openTasks.count || 0,
      open_opportunities: openOpps.count || 0,
      pipeline_value_cents: pipelineValueCents,
      pipeline_estimate_cents: pipelineEstimateCents,
      won_total_cents: wonTotalCents,
      won_this_month_cents: wonMonthCents,
      won_deals: (wonOpps.data || []).length,
    },
    upcoming_appointments: upcomingAppointments.data || [],
    recent_activities: recentActivities.data || [],
  });
}
