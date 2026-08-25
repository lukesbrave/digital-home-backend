/**
 * POST /api/crm/capture — universal lead-capture endpoint.
 *
 * The front door for every lead source: site forms (proxied server-side),
 * GHL webhooks during migration, Zapier/Make, or agents. Upserts by email,
 * logs activities, and fires workflow triggers.
 *
 * Auth: x-capture-key header (crm_capture_key setting) or standard API auth.
 * Body: { email, name?, first_name?, last_name?, phone?, company?,
 *         source?, page?, form?, message?, tags?: string[],
 *         interested_offers?: string[], custom?: {}, workflow_id? }
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { authenticateCapture } from "@/lib/crm/capture-auth";
import { isValidEmail, upsertLead } from "@/lib/crm/leads";
import { enrollLead, ensureLeadOpportunity } from "@/lib/crm/engine";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-capture-key",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: NextRequest) {
  const supabase = createAdminClient();

  const auth = await authenticateCapture(request, supabase);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS_HEADERS });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS_HEADERS });
  }

  // Honeypot: bots fill every field — silently accept and drop
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
  }

  const email = typeof body.email === "string" ? body.email : "";
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "Valid email is required" }, { status: 400, headers: CORS_HEADERS });
  }

  try {
    const input = {
      email,
      name: body.name as string | undefined,
      first_name: body.first_name as string | undefined,
      last_name: body.last_name as string | undefined,
      phone: body.phone as string | undefined,
      company: body.company as string | undefined,
      source: (body.source as string | undefined) || (body.form as string | undefined) || "capture",
      capture_page: (body.page as string | undefined) || (body.capture_page as string | undefined),
      form: body.form as string | undefined,
      message: body.message as string | undefined,
      tags: Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === "string") : [],
      interested_offers: Array.isArray(body.interested_offers)
        ? body.interested_offers.filter((offer): offer is string => typeof offer === "string")
        : [],
      custom:
        body.custom && typeof body.custom === "object" && !Array.isArray(body.custom)
          ? (body.custom as Record<string, unknown>)
          : {},
    };

    const { lead, created } = await upsertLead(supabase, input, { actor: `capture:${auth.via}` });

    // Auto-file into the sales pipeline: a fresh inbound lead opens a deal in
    // "New". Idempotent and forward-only. If upsertLead already enrolled them
    // in a sequence via a tag trigger, that enroll hook has already put them in
    // "Nurturing" — this call then no-ops. Never fail a capture over a pipeline write.
    try {
      await ensureLeadOpportunity(supabase, lead, { stage: "New", actor: `capture:${auth.via}` });
    } catch (e) {
      console.error("capture: ensureLeadOpportunity failed", e);
    }

    // Optional direct enrollment into a specific workflow
    if (typeof body.workflow_id === "string" && body.workflow_id) {
      const { data: wf } = await supabase.from("workflows").select("*").eq("id", body.workflow_id).single();
      if (wf && wf.status === "active") await enrollLead(supabase, wf, lead, "capture");
    }

    return NextResponse.json({ ok: true, lead_id: lead.id, created }, { headers: CORS_HEADERS });
  } catch (e) {
    const message = e instanceof Error ? e.message : "capture failed";
    return NextResponse.json({ error: message }, { status: 500, headers: CORS_HEADERS });
  }
}
