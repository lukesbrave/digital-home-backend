/**
 * GET    /api/crm/leads/[id] — full lead profile (activities, enrollments, opps, tasks, sends)
 * PATCH  /api/crm/leads/[id] — update fields; diffs are logged + fire triggers
 * DELETE /api/crm/leads/[id] — hard delete (GDPR) incl. email history
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateSessionOrApiKey, unauthorizedResponse } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/crm/activity";
import { fireTrigger } from "@/lib/crm/engine";
import type { Json } from "@/types/database";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);

  const { id } = await params;
  const supabase = createAdminClient();

  const { data: lead, error } = await supabase.from("leads").select("*").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const [activities, enrollments, opportunities, tasks, sends, appointments, visitors] = await Promise.all([
    supabase
      .from("lead_activities")
      .select("*")
      .eq("lead_id", id)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("workflow_enrollments")
      .select("*, workflows(id, name, status, steps)")
      .eq("lead_id", id)
      .order("enrolled_at", { ascending: false }),
    supabase
      .from("opportunities")
      .select("*, pipeline_stages(id, name)")
      .eq("lead_id", id)
      .order("created_at", { ascending: false }),
    supabase.from("crm_tasks").select("*").eq("lead_id", id).order("created_at", { ascending: false }),
    supabase
      .from("email_sends")
      .select("id, subject, status, sent_at, created_at, opened_at, clicked_at, workflow_id")
      .eq("lead_id", id)
      .order("created_at", { ascending: false })
      .limit(25),
    supabase.from("appointments").select("*").eq("lead_id", id).order("starts_at", { ascending: false }),
    supabase
      .from("visitors")
      .select(
        "anonymous_id, first_source, first_medium, first_campaign, first_referrer_domain, is_ai_traffic, ai_referrer_source, latest_source, latest_medium, latest_campaign, visit_count, first_seen_at, last_seen_at, pages_viewed, device_type, browser, country, city"
      )
      .eq("lead_id", id)
      .order("last_seen_at", { ascending: false })
      .limit(5),
  ]);

  // Where the lead entered a funnel: first event of their session carries the
  // landing URL (UTMs included — funnel_events.page_url keeps the query string)
  // and referrer. Fail-soft: attribution is context, never worth a 500.
  const custom = (lead.custom && typeof lead.custom === "object" ? lead.custom : {}) as Record<string, unknown>;
  const sessionId = typeof custom.funnel_session_id === "string" ? custom.funnel_session_id : null;
  let funnelFirstTouch: Record<string, unknown> | null = null;
  if (sessionId) {
    const { data: ft, error: ftErr } = await supabase
      .from("funnel_events")
      .select("funnel, page_url, referrer, created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true })
      .limit(1);
    if (ftErr) console.warn("lead detail: funnel first-touch lookup failed", ftErr.message);
    const first = ft?.[0];
    if (first) {
      let utm: Record<string, string> = {};
      try {
        const sp = new URL(first.page_url || "", "https://x.invalid").searchParams;
        utm = Object.fromEntries(
          ["utm_source", "utm_medium", "utm_campaign", "utm_content"]
            .map((k) => [k.slice(4), sp.get(k) || ""])
            .filter(([, v]) => v)
        );
      } catch {
        // unparseable page_url — keep the raw fields
      }
      funnelFirstTouch = {
        funnel: first.funnel,
        landed_at: first.created_at,
        page_url: first.page_url,
        referrer: first.referrer,
        ...utm,
      };
    }
  }

  return NextResponse.json({
    lead,
    activities: activities.data || [],
    enrollments: enrollments.data || [],
    opportunities: opportunities.data || [],
    tasks: tasks.data || [],
    sends: sends.data || [],
    appointments: appointments.data || [],
    visitors: visitors.data || [],
    funnel_first_touch: funnelFirstTouch,
  });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);

  const { id } = await params;
  const supabase = createAdminClient();
  const body = await request.json().catch(() => ({}));
  const actor = auth.mode === "session" ? "human" : `agent:${auth.agent}`;

  const { data: lead } = await supabase.from("leads").select("*").eq("id", id).maybeSingle();
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const updates: Record<string, unknown> = {};
  for (const field of ["first_name", "last_name", "phone", "company", "score", "timezone", "email_status"]) {
    if (field in body) updates[field] = body[field];
  }
  if ("custom" in body && body.custom && typeof body.custom === "object") {
    updates.custom = body.custom as Json;
  }
  if ("email" in body && typeof body.email === "string" && body.email.trim()) {
    updates.email = body.email.trim().toLowerCase();
  }

  const statusChanged = "status" in body && body.status && body.status !== lead.status;
  if (statusChanged) updates.status = body.status;

  let addedTags: string[] = [];
  let removedTags: string[] = [];
  if (Array.isArray(body.tags)) {
    const newTags: string[] = body.tags.map((t: string) => t.trim()).filter(Boolean);
    addedTags = newTags.filter((t) => !(lead.tags || []).includes(t));
    removedTags = (lead.tags || []).filter((t) => !newTags.includes(t));
    updates.tags = newTags;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ lead });
  }

  const { data: updated, error } = await supabase
    .from("leads")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();
  if (error || !updated) {
    return NextResponse.json({ error: error?.message || "update failed" }, { status: 500 });
  }

  // Log + fire triggers on meaningful diffs
  if (statusChanged) {
    await logActivity(supabase, {
      lead_id: id,
      activity_type: "status_changed",
      title: `Status: ${lead.status} → ${updated.status}`,
      data: { from: lead.status, status: updated.status },
      actor,
    });
    await fireTrigger(supabase, { type: "status_changed", lead: updated, data: { status: updated.status } });
  }
  for (const tag of addedTags) {
    await logActivity(supabase, {
      lead_id: id,
      activity_type: "tag_added",
      title: `Tag added: ${tag}`,
      data: { tag },
      actor,
    });
    await fireTrigger(supabase, { type: "tag_added", lead: updated, data: { tag } });
  }
  for (const tag of removedTags) {
    await logActivity(supabase, {
      lead_id: id,
      activity_type: "tag_removed",
      title: `Tag removed: ${tag}`,
      data: { tag },
      actor,
    });
  }
  if ("email_status" in updates && updates.email_status !== lead.email_status) {
    await logActivity(supabase, {
      lead_id: id,
      activity_type: updates.email_status === "unsubscribed" ? "unsubscribed" : "field_updated",
      title: `Email status: ${lead.email_status} → ${updates.email_status}`,
      actor,
    });
  }

  return NextResponse.json({ lead: updated });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);

  const { id } = await params;
  const supabase = createAdminClient();

  const { data: lead } = await supabase.from("leads").select("id").eq("id", id).maybeSingle();
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  // Tables without ON DELETE CASCADE must be cleared explicitly, in FK order
  await supabase.from("email_events").delete().eq("lead_id", id);
  await supabase.from("email_sends").delete().eq("lead_id", id);
  await supabase.from("visitors").update({ lead_id: null }).eq("lead_id", id);
  await supabase.from("conversations").update({ lead_id: null }).eq("lead_id", id);

  const { error } = await supabase.from("leads").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ deleted: true });
}
