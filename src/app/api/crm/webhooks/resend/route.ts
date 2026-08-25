/**
 * POST /api/crm/webhooks/resend — Resend events (svix-signed).
 * Configure in Resend: Webhooks → add endpoint → this URL, then
 * `wrangler secret put RESEND_WEBHOOK_SECRET` with the whsec_ value.
 *
 * Outbound: maps delivered/opened/clicked/bounced/complained onto
 * email_sends + email_events, and flips lead email_status on bounces/
 * complaints so the suppression check stops future sends automatically.
 *
 * Inbound (email.received): a reply to the sending subdomain (Resend
 * inbound needs an MX record on the SENDING subdomain only — never the
 * root domain) is matched to the lead by sender address and logged on
 * their timeline as an email_received activity with the message text.
 */
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/crm/activity";

function verifySvix(secret: string, id: string, timestamp: string, payload: string, signatureHeader: string): boolean {
  try {
    const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    const signedContent = `${id}.${timestamp}.${payload}`;
    const expected = createHmac("sha256", secretBytes).update(signedContent).digest("base64");
    // Header format: "v1,<base64sig> v1,<base64sig2> ..."
    for (const part of signatureHeader.split(" ")) {
      const [, sig] = part.split(",");
      if (!sig) continue;
      const a = Buffer.from(expected);
      const b = Buffer.from(sig);
      if (a.length === b.length && timingSafeEqual(a, b)) return true;
    }
  } catch {
    return false;
  }
  return false;
}

const EVENT_MAP: Record<string, "delivered" | "opened" | "clicked" | "bounced" | "complained"> = {
  "email.delivered": "delivered",
  "email.opened": "opened",
  "email.clicked": "clicked",
  "email.bounced": "bounced",
  "email.complained": "complained",
};

export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "RESEND_WEBHOOK_SECRET not configured" }, { status: 501 });
  }

  const payload = await request.text();
  const svixId = request.headers.get("svix-id") || "";
  const svixTimestamp = request.headers.get("svix-timestamp") || "";
  const svixSignature = request.headers.get("svix-signature") || "";

  if (!verifySvix(secret, svixId, svixTimestamp, payload, svixSignature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: {
    type?: string;
    data?: {
      email_id?: string;
      click?: { link?: string };
      from?: string | { email?: string; name?: string };
      subject?: string;
      text?: string;
      html?: string;
    };
  };
  try {
    event = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (event.type === "email.received") {
    return handleInbound(event.data || {});
  }

  const mapped = EVENT_MAP[event.type || ""];
  const resendId = event.data?.email_id;
  if (!mapped || !resendId) return NextResponse.json({ ok: true, ignored: true });

  const supabase = createAdminClient();
  const { data: send } = await supabase
    .from("email_sends")
    .select("id, lead_id, subject, opened_at, clicked_at")
    .eq("resend_id", resendId)
    .maybeSingle();
  if (!send) return NextResponse.json({ ok: true, unmatched: true });

  await supabase.from("email_events").insert({
    send_id: send.id,
    lead_id: send.lead_id,
    event_type: mapped,
    event_data: (event.data || {}) as never,
  });

  if (mapped === "opened" && !send.opened_at) {
    await supabase.from("email_sends").update({ opened_at: new Date().toISOString() }).eq("id", send.id);
    await logActivity(supabase, {
      lead_id: send.lead_id,
      activity_type: "email_opened",
      title: `Opened: ${send.subject}`,
      data: { send_id: send.id },
    });
  }
  if (mapped === "clicked" && !send.clicked_at) {
    await supabase.from("email_sends").update({ clicked_at: new Date().toISOString() }).eq("id", send.id);
    await logActivity(supabase, {
      lead_id: send.lead_id,
      activity_type: "email_clicked",
      title: `Clicked: ${send.subject}`,
      data: { send_id: send.id, link: event.data?.click?.link },
    });
  }
  if (mapped === "bounced") {
    await supabase.from("email_sends").update({ status: "bounced" }).eq("id", send.id);
    await supabase.from("leads").update({ email_status: "bounced" }).eq("id", send.lead_id);
    await logActivity(supabase, {
      lead_id: send.lead_id,
      activity_type: "email_bounced",
      title: `Bounced: ${send.subject}`,
      data: { send_id: send.id },
    });
  }
  if (mapped === "complained") {
    await supabase.from("leads").update({ email_status: "complained" }).eq("id", send.lead_id);
    await logActivity(supabase, {
      lead_id: send.lead_id,
      activity_type: "unsubscribed",
      title: "Marked as spam (complaint) — suppressed",
      data: { send_id: send.id },
    });
  }

  return NextResponse.json({ ok: true });
}

/**
 * A reply landed on the sending subdomain. Match it to a lead by sender
 * address and put the message on their timeline. Unmatched senders are
 * acknowledged (200) so Resend doesn't retry — we only track known leads.
 */
async function handleInbound(data: {
  email_id?: string;
  from?: string | { email?: string; name?: string };
  subject?: string;
  text?: string;
  html?: string;
}) {
  const rawFrom = typeof data.from === "string" ? data.from : data.from?.email || "";
  const fromEmail = (rawFrom.match(/<([^>]+)>/)?.[1] || rawFrom).trim().toLowerCase();
  if (!fromEmail || !fromEmail.includes("@")) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const supabase = createAdminClient();
  const { data: lead } = await supabase
    .from("leads")
    .select("id, status")
    .eq("email", fromEmail)
    .maybeSingle();
  if (!lead) return NextResponse.json({ ok: true, unmatched_inbound: true });

  const subject = (data.subject || "(no subject)").slice(0, 300);
  // Plain text preferred; fall back to crudely stripped HTML. Capped so a
  // giant reply chain can't bloat the activity row.
  const text = (
    data.text ||
    (data.html || "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
  )
    .trim()
    .slice(0, 20_000);

  await logActivity(supabase, {
    lead_id: lead.id,
    activity_type: "email_received",
    title: `Reply received: ${subject}`,
    body: text || null,
    data: { from: fromEmail, subject, resend_email_id: data.email_id || null },
    actor: "lead",
  });

  // A reply is the strongest engagement signal a new lead can give.
  if (lead.status === "new") {
    await supabase.from("leads").update({ status: "engaged" }).eq("id", lead.id);
  }

  return NextResponse.json({ ok: true, inbound: true });
}
