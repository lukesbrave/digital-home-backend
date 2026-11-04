/**
 * Invoices: a Home draft → a finalized Stripe invoice → emailed to the
 * client. The email is the outward step, so it is skipped while
 * crm_safe_mode is on: the invoice is finalized in Stripe (number, hosted
 * page, PDF) and stays a draft here until safe mode is off and it is sent.
 *
 * Resumable: the Stripe invoice id is recorded the moment Stripe makes the
 * draft, and finalizing is marked in metadata, so a retry after any failure
 * picks up where it stopped instead of making a second invoice in Stripe.
 *
 * Relative imports only, so the tests run it against a fake client.
 */

import type { Json, MoneyRow } from "../../types/database.ts";
import type { MoneyClient } from "./db.ts";
import { addTimelineEntry, metaOf, must, readSafeMode, selectAllIn } from "./db-util.ts";
import { formatMinor, lineTotal } from "./money.ts";
import { pushInvoiceToStripe, sendInvoice, type StripeOptions, type StripeResult } from "./stripe-client.ts";

export type Invoice = MoneyRow<"invoices">;

type Failure = Extract<StripeResult<unknown>, { ok: false }>;

export type SendOutcome =
  | { ok: true; invoice: Invoice; sent: boolean; safe_mode: boolean }
  | { ok: false; failure: Failure; invoice: Invoice };

function daysUntil(dueAt: string | null): number {
  if (!dueAt) return 14;
  const days = Math.ceil((Date.parse(dueAt) - Date.now()) / 86_400_000);
  return Number.isFinite(days) ? Math.max(1, Math.min(days, 365)) : 14;
}

function fail(invoice: Invoice, status: number, error: string): SendOutcome {
  return { ok: false, invoice, failure: { ok: false, status, error } };
}

export function isFinalized(invoice: Invoice): boolean {
  return metaOf(invoice.metadata).stripe_finalized === true;
}

/**
 * Finalizes the invoice in Stripe unless it already is, then emails it
 * unless safe mode is on. Refuses an invoice with no items, or whose items
 * do not add up to its total.
 */
export async function pushAndSendInvoice(
  db: MoneyClient,
  invoice: Invoice,
  actor: string,
  stripe: StripeOptions = {}
): Promise<SendOutcome> {
  let current = invoice;

  if (!isFinalized(current)) {
    const lead = current.lead_id
      ? must(await db.from("leads").select("email, first_name, last_name").eq("id", current.lead_id).maybeSingle(), "lead lookup")
      : null;
    if (!lead?.email) return fail(current, 400, "The invoice has no client email (set lead_id or email)");

    const items = await selectAllIn(
      (from, to) => db.from("invoice_items").select("*").eq("invoice_id", current.id).order("created_at").range(from, to),
      "invoice items"
    );
    if (items.length === 0) return fail(current, 409, "The invoice has no items");
    const total = lineTotal(items);
    if (total !== current.total_minor) {
      return fail(current, 409, `The items add up to ${total ?? "an invalid amount"}, not the invoice total ${current.total_minor}`);
    }

    const invoiceId = current.id;
    const pushed = await pushInvoiceToStripe(
      {
        homeInvoiceId: invoiceId,
        email: lead.email,
        name: [lead.first_name, lead.last_name].filter(Boolean).join(" ") || null,
        currency: current.currency,
        daysUntilDue: daysUntil(current.due_at),
        description: `Invoice ${current.number}`,
        items: items.map((i) => ({ description: i.description, quantity: i.quantity, amount_minor: i.amount_minor })),
      },
      {
        existingStripeId: current.stripe_invoice_id,
        onDraftCreated: async (stripeInvoiceId) => {
          must(await db.from("invoices").update({ stripe_invoice_id: stripeInvoiceId }).eq("id", invoiceId), "invoice stripe id");
        },
      },
      stripe
    );
    if (!pushed.ok) return { ok: false, invoice: current, failure: pushed };

    const updated = must(
      await db
        .from("invoices")
        .update({
          stripe_invoice_id: pushed.data.id,
          hosted_url: pushed.data.hosted_invoice_url,
          pdf_url: pushed.data.invoice_pdf,
          metadata: { ...metaOf(current.metadata), stripe_number: pushed.data.number, stripe_finalized: true } as Json,
        })
        .eq("id", invoiceId)
        .select("*")
        .single(),
      "invoice update"
    );
    if (!updated) throw new Error("invoice update returned nothing");
    current = updated;
  }

  const safeMode = await readSafeMode(db);
  if (safeMode || current.status !== "draft") return { ok: true, invoice: current, sent: false, safe_mode: safeMode };

  const sent = await sendInvoice(current.stripe_invoice_id!, stripe);
  if (!sent.ok) return { ok: false, invoice: current, failure: sent };

  const rows = must(
    await db
      .from("invoices")
      .update({ status: "sent", hosted_url: sent.data.hosted_invoice_url ?? current.hosted_url, pdf_url: sent.data.invoice_pdf ?? current.pdf_url })
      .eq("id", current.id)
      .eq("status", "draft")
      .select("*"),
    "invoice sent"
  );
  const updated = rows?.[0] ?? current;

  if (updated.lead_id) {
    await addTimelineEntry(db, {
      lead_id: updated.lead_id,
      activity_type: "invoice_sent",
      title: `Invoice ${updated.number} sent: ${formatMinor(updated.total_minor, updated.currency, { exact: true })}`,
      data: { invoice_id: updated.id, stripe_invoice_id: updated.stripe_invoice_id, hosted_url: updated.hosted_url },
      actor,
    });
  }
  return { ok: true, invoice: updated, sent: true, safe_mode: false };
}
