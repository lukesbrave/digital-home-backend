/**
 * GET   /api/crm/invoices — newest first, with items. ?status= ?lead_id= ?engagement_id= ?limit=   money:read
 * POST  /api/crm/invoices — { lead_id | email, name?, engagement_id?, currency?, due_days?,
 *                             items: [{ description, quantity?, amount_minor, product_id? }], send? }  money:write
 *   send (default true) finalizes the invoice in Stripe and emails it to the client.
 *   send: false keeps a Home draft only and needs no Stripe key.
 * PATCH /api/crm/invoices — { id, send: true } | { id, status: "void" } | { id, due_at } (drafts)       money:write
 *   Voiding deletes a Stripe copy that is still a draft and voids an open one.
 *
 * While crm_safe_mode is on the invoice is finalized in Stripe but not
 * emailed; the response says { sent: false, safe_mode: true }. Sending needs
 * both Stripe secrets (503 otherwise), so the payment is heard when it comes.
 * The currency defaults to the engagement's, else backend_settings.money_currency.
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateSessionOrApiKey, requireScope, unauthorizedResponse } from "@/lib/api/auth";
import type { InvoiceStatus, MoneyRow } from "@/types/database";
import { createAdminClient } from "@/lib/supabase/server";
import { upsertLead, isValidEmail, normalizeEmail } from "@/lib/crm/leads";
import { moneyDb } from "@/lib/money/db";
import { normalizeCurrency, lineTotal } from "@/lib/money/money";
import { listWindow, selectAllIn, windowed } from "@/lib/money/db-util";
import { homeCurrency } from "@/lib/money/engagements";
import { checkLines, isUuid, newInvoiceNumber } from "@/lib/money/records";
import { transitionInvoice } from "@/lib/money/state";
import { pushAndSendInvoice } from "@/lib/money/invoices";
import { cancelInvoice, isMoneyReady, NOT_CONFIGURED } from "@/lib/money/stripe-client";
import { actorOf, readJson, stripeFailure } from "@/lib/money/route-auth";

const STATUSES: readonly InvoiceStatus[] = ["draft", "sent", "paid", "void"];

export async function GET(request: NextRequest) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  const denied = requireScope(auth, "money:read");
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const db = moneyDb();
  const { limit, offset } = listWindow(request.url);
  let query = db.from("invoices").select("*").order("created_at", { ascending: false }).range(offset, offset + limit);
  const status = params.get("status");
  if (status && STATUSES.includes(status as InvoiceStatus)) query = query.eq("status", status as InvoiceStatus);
  const leadId = params.get("lead_id");
  if (isUuid(leadId)) query = query.eq("lead_id", leadId);
  const engagementId = params.get("engagement_id");
  if (isUuid(engagementId)) query = query.eq("engagement_id", engagementId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const { rows: invoices, has_more } = windowed(data, limit);
  const ids = invoices.map((i) => i.id);
  let items: MoneyRow<"invoice_items">[] = [];
  try {
    items = ids.length
      ? await selectAllIn((from, to) => db.from("invoice_items").select("*").in("invoice_id", ids).order("created_at").range(from, to), "invoice items")
      : [];
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
  return NextResponse.json({
    invoices: invoices.map((inv) => ({ ...inv, items: items.filter((i) => i.invoice_id === inv.id) })),
    has_more,
  });
}

export async function POST(request: NextRequest) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  const denied = requireScope(auth, "money:write");
  if (denied) return denied;

  const body = await readJson(request);
  const send = body.send !== false;
  if (send && !isMoneyReady()) return NextResponse.json({ error: NOT_CONFIGURED }, { status: 503 });

  const lines = checkLines(body.items);
  if (!lines.ok) return NextResponse.json({ error: lines.error }, { status: 400 });
  const total = lineTotal(lines.value);
  if (total === null) return NextResponse.json({ error: "the invoice total is out of range" }, { status: 400 });

  const admin = createAdminClient();
  const db = moneyDb(admin);

  let engagement: { id: string; lead_id: string | null; currency: string } | null = null;
  if (body.engagement_id !== undefined && body.engagement_id !== null) {
    if (!isUuid(body.engagement_id)) return NextResponse.json({ error: "engagement_id must be a uuid" }, { status: 400 });
    const { data } = await db.from("engagements").select("id, lead_id, currency").eq("id", body.engagement_id).maybeSingle();
    if (!data) return NextResponse.json({ error: "Engagement not found" }, { status: 404 });
    engagement = data;
  }

  // The client: an existing lead, the engagement's lead, or a lead made from the email.
  let leadId: string | null = null;
  if (isUuid(body.lead_id)) {
    const { data } = await admin.from("leads").select("id").eq("id", body.lead_id).maybeSingle();
    if (!data) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    leadId = data.id;
  } else if (typeof body.email === "string" && body.email.trim()) {
    const email = normalizeEmail(body.email);
    if (!isValidEmail(email)) return NextResponse.json({ error: "email is not valid" }, { status: 400 });
    // An existing client is used as is: upsertLead with a source would log a
    // "Form submitted" on them. A new one is created with triggers off, so a
    // client being billed never drops into a welcome sequence.
    const existing = await admin.from("leads").select("id").ilike("email", email.replace(/[%_\\]/g, "\\$&")).limit(1).maybeSingle();
    if (existing.error) return NextResponse.json({ error: existing.error.message }, { status: 500 });
    leadId =
      existing.data?.id ??
      (
        await upsertLead(
          admin,
          { email, name: typeof body.name === "string" ? body.name : null, source: "invoice" },
          { actor: actorOf(auth), fireTriggers: false }
        )
      ).lead.id;
  } else {
    leadId = engagement?.lead_id ?? null;
  }
  if (!leadId) return NextResponse.json({ error: "lead_id or email is required" }, { status: 400 });

  const currency =
    body.currency === undefined ? engagement?.currency || (await homeCurrency(db)) : normalizeCurrency(body.currency);
  if (!currency) return NextResponse.json({ error: "currency must be a three-letter ISO code" }, { status: 400 });
  const dueDays = body.due_days === undefined ? 14 : Number(body.due_days);
  if (!Number.isInteger(dueDays) || dueDays < 1 || dueDays > 365) {
    return NextResponse.json({ error: "due_days must be 1–365" }, { status: 400 });
  }

  let invoice = null;
  for (let attempt = 0; attempt < 3 && !invoice; attempt++) {
    const { data, error } = await db
      .from("invoices")
      .insert({
        number: newInvoiceNumber(),
        lead_id: leadId,
        engagement_id: engagement?.id ?? null,
        status: "draft",
        due_at: new Date(Date.now() + dueDays * 86_400_000).toISOString(),
        total_minor: total,
        currency,
      })
      .select("*")
      .single();
    if (error && error.code !== "23505") return NextResponse.json({ error: error.message }, { status: 500 });
    invoice = data;
  }
  if (!invoice) return NextResponse.json({ error: "could not allocate an invoice number" }, { status: 500 });

  const { error: itemsError } = await db
    .from("invoice_items")
    .insert(lines.value.map((l) => ({ ...l, invoice_id: invoice.id, product_id: isUuid(l.product_id) ? l.product_id : null })));
  if (itemsError) {
    // No half-made invoice: the draft goes with its items.
    await db.from("invoices").delete().eq("id", invoice.id);
    return NextResponse.json({ error: itemsError.message }, { status: 500 });
  }

  if (!send) return NextResponse.json({ invoice, sent: false }, { status: 201 });

  const outcome = await pushAndSendInvoice(db, invoice, actorOf(auth));
  if (!outcome.ok) {
    const failed = stripeFailure(outcome.failure);
    const payload = (await failed.json()) as { error: string };
    return NextResponse.json({ ...payload, invoice: outcome.invoice }, { status: failed.status });
  }
  return NextResponse.json(
    { invoice: outcome.invoice, sent: outcome.sent, safe_mode: outcome.safe_mode },
    { status: 201 }
  );
}

export async function PATCH(request: NextRequest) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  const denied = requireScope(auth, "money:write");
  if (denied) return denied;

  const body = await readJson(request);
  if (!isUuid(body.id)) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const admin = createAdminClient();
  const db = moneyDb(admin);
  const { data: invoice } = await db.from("invoices").select("*").eq("id", body.id).maybeSingle();
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  if (body.status === "void") {
    const move = transitionInvoice(invoice.status, "void");
    if (!move.ok) return NextResponse.json({ error: move.reason }, { status: 409 });
    if (!move.changed) return NextResponse.json({ invoice });
    if (invoice.stripe_invoice_id) {
      const cancelled = await cancelInvoice(invoice.stripe_invoice_id);
      if (!cancelled.ok) return stripeFailure(cancelled);
    }
    // Only from the status read: a payment that landed meanwhile wins.
    const { data, error } = await db
      .from("invoices")
      .update({ status: "void" })
      .eq("id", invoice.id)
      .eq("status", invoice.status)
      .select("*");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data?.length) return NextResponse.json({ error: "The invoice changed while voiding it; read it again" }, { status: 409 });
    return NextResponse.json({ invoice: data[0] });
  }

  if (body.send === true) {
    if (invoice.status !== "draft") return NextResponse.json({ error: `invoice is ${invoice.status}` }, { status: 409 });
    if (!isMoneyReady()) return NextResponse.json({ error: NOT_CONFIGURED }, { status: 503 });
    const outcome = await pushAndSendInvoice(db, invoice, actorOf(auth));
    if (!outcome.ok) return stripeFailure(outcome.failure);
    return NextResponse.json({ invoice: outcome.invoice, sent: outcome.sent, safe_mode: outcome.safe_mode });
  }

  if ("due_at" in body) {
    if (invoice.status !== "draft" || invoice.stripe_invoice_id) {
      return NextResponse.json({ error: "only an unsent draft's due date can change" }, { status: 409 });
    }
    const due = typeof body.due_at === "string" ? Date.parse(body.due_at) : NaN;
    if (!Number.isFinite(due)) return NextResponse.json({ error: "due_at must be an ISO date" }, { status: 400 });
    const { data, error } = await db
      .from("invoices")
      .update({ due_at: new Date(due).toISOString() })
      .eq("id", invoice.id)
      .select("*")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ invoice: data });
  }

  return NextResponse.json({ error: "nothing to change: pass send: true, status: \"void\" or due_at" }, { status: 400 });
}
