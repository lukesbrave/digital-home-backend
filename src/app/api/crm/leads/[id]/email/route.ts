/**
 * POST /api/crm/leads/[id]/email — one-off email to this lead through the
 * normal CRM engine: merge tags render, suppression and safe mode apply, and
 * the send lands in email_sends and on the lead timeline like any other.
 * Body: { subject, body_md, preheader? }
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateSessionOrApiKey, unauthorizedResponse } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { sendCrmEmail } from "@/lib/crm/email";
import type { Lead } from "@/lib/crm/types";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const bodyMd = typeof body.body_md === "string" ? body.body_md.trim() : "";
  if (!subject || !bodyMd) {
    return NextResponse.json({ error: "subject and body_md are required" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: lead, error } = await supabase.from("leads").select("*").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const result = await sendCrmEmail(supabase, {
    lead: lead as Lead,
    subject,
    bodyMd,
    preheader:
      typeof body.preheader === "string" && body.preheader.trim() ? body.preheader.trim() : null,
    actor: auth.mode === "session" ? "human" : `agent:${auth.agent}`,
  });

  if (result.status === "failed") {
    return NextResponse.json({ error: result.error || "Send failed", result }, { status: 502 });
  }
  return NextResponse.json({ result });
}
