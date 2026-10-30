/**
 * The database half of the Stripe webhook: a WebhookStore (./webhook.ts)
 * backed by Supabase. Records and claims events in payment_events, moves
 * orders and invoices by the pure transitions in ./state.ts, and turns the
 * buyer into a customer lead.
 *
 * Rules it keeps:
 * - Every read and write checks its error and throws, so a database hiccup
 *   leaves the event unprocessed and Stripe redelivers it. Only a confirmed
 *   empty result takes a "nothing matches" branch.
 * - A status moves with a conditional update (where status is still what was
 *   read), stamped with the event that moved it. A retry of that same event
 *   resumes the rest of the work; a different event that lost the race does
 *   nothing. Timeline entries are written once per event, tags only fire for
 *   tags that were not there, and enrolment has its own re-enrolment rule, so
 *   resuming never doubles anything.
 * - Payments never fire lead_created or form_submitted: leads are created
 *   with triggers off, then tag_added fires for each new tag. A refund or a
 *   cancellation never creates a lead.
 * - Nothing here sends anything. A lead enrolled in the onboarding workflow
 *   is emailed by the engine on its next tick, through lib/crm/email.ts,
 *   which simulates every send while crm_safe_mode is on.
 *
 * Relative imports only, so the tests run it against a fake client.
 */

import type { InvoiceStatus, Json, MoneyRow, MoneyTables, OrderStatus } from "../../types/database.ts";
import type { Lead, Workflow } from "../crm/types.ts";
import type { MoneyClient } from "./db.ts";
import type { MoneyDeps } from "./deps.ts";
import { addTimelineEntry, metaOf, must, readSetting } from "./db-util.ts";
import { formatMinor } from "./money.ts";
import { isUuid, ONBOARDING_SETTING } from "./records.ts";
import {
  applyTagChanges,
  invoiceTarget,
  leadEffects,
  orderTarget,
  refundedSoFar,
  transitionInvoice,
  transitionOrder,
  type LeadEffect,
  type MoneyPlan,
  type StripeEventLike,
} from "./state.ts";
import {
  invoiceForPaymentIntent,
  invoiceSubscriptionId,
  isStripeConfigured,
  retrieveInvoice,
  retrievePaymentIntent,
  retrieveSubscription,
} from "./stripe-client.ts";
import type { ApplyResult, WebhookStore } from "./webhook.ts";

type Order = MoneyRow<"orders">;
type Invoice = MoneyRow<"invoices">;

const ACTOR = "stripe";
const CLAIM_TIMEOUT_MS = 5 * 60_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** enrollLead reasons that are the workflow's own rules, not failures. */
const BENIGN_ENROL = ["already active", "re-enrollment not allowed"];

interface Ctx {
  db: MoneyClient;
  deps: MoneyDeps;
  event: StripeEventLike;
}

/** Thrown when an event arrived before the one it depends on; the event stays unprocessed and Stripe retries it. */
export class NotYet extends Error {}

export function createWebhookStore(db: MoneyClient, deps: MoneyDeps, opts: { now?: () => Date } = {}): WebhookStore {
  const now = () => (opts.now ? opts.now() : new Date());

  return {
    async recordEvent(event, rawPayload) {
      const { error } = await db.from("payment_events").insert({
        provider: "stripe",
        provider_event_id: event.id,
        type: event.type,
        livemode: typeof event.livemode === "boolean" ? event.livemode : null,
        payload: rawPayload as Json,
      });
      if (!error) return "recorded";
      if (error.code !== "23505") throw new Error(`payment_events insert failed: ${error.message}`);
      const row = must(
        await db.from("payment_events").select("processed_at").eq("provider_event_id", event.id).maybeSingle(),
        "payment_events lookup"
      );
      return row?.processed_at ? "duplicate" : "recorded";
    },

    async claimEvent(eventId) {
      const at = now();
      const fresh = must(
        await db
          .from("payment_events")
          .update({ claimed_at: at.toISOString() })
          .eq("provider_event_id", eventId)
          .is("processed_at", null)
          .is("claimed_at", null)
          .select("id"),
        "payment_events claim"
      );
      if (fresh && fresh.length > 0) return true;
      // A claim older than the timeout belongs to a delivery that died mid-way.
      const stale = must(
        await db
          .from("payment_events")
          .update({ claimed_at: at.toISOString() })
          .eq("provider_event_id", eventId)
          .is("processed_at", null)
          .lt("claimed_at", new Date(at.getTime() - CLAIM_TIMEOUT_MS).toISOString())
          .select("id"),
        "payment_events reclaim"
      );
      return !!stale && stale.length > 0;
    },

    async finishEvent(eventId, result) {
      must(
        await db
          .from("payment_events")
          .update({ processed_at: now().toISOString(), claimed_at: null, error: null, result: result as unknown as Json })
          .eq("provider_event_id", eventId),
        "payment_events finish"
      );
    },

    async releaseEvent(eventId, error) {
      must(
        await db.from("payment_events").update({ claimed_at: null, error }).eq("provider_event_id", eventId),
        "payment_events release"
      );
    },

    applyPlan(plan, event) {
      return applyPlan({ db, deps, event }, plan);
    },
  };
}

// ── plans ────────────────────────────────────────────────────────────────────

export async function applyPlan(ctx: Ctx, plan: MoneyPlan): Promise<ApplyResult> {
  switch (plan.kind) {
    case "checkout_paid":
      return checkoutPaid(ctx, plan);
    case "checkout_failed":
      return checkoutFailed(ctx, plan);
    case "invoice_paid":
      return invoicePaid(ctx, plan);
    case "charge_refunded":
      return chargeRefunded(ctx, plan);
    case "subscription_ended":
      return subscriptionEnded(ctx, plan);
    default:
      return { summary: "nothing to do" };
  }
}

function stripeReady(ctx: Ctx): boolean {
  return isStripeConfigured(ctx.deps.stripe?.env ?? process.env);
}

async function orderBy(ctx: Ctx, column: "id" | "stripe_checkout_session_id" | "stripe_payment_intent_id" | "stripe_subscription_id", value: string) {
  return must(await ctx.db.from("orders").select("*").eq(column, value).maybeSingle(), `order lookup by ${column}`);
}

/**
 * The order for a Checkout Session: by the session id, else by the
 * metadata.order_id the Home put on the session, accepted only while that
 * order has no session or this one.
 */
async function orderForSession(ctx: Ctx, sessionId: string, orderId: string | null): Promise<Order | null> {
  const bySession = await orderBy(ctx, "stripe_checkout_session_id", sessionId);
  if (bySession) return bySession;
  if (!isUuid(orderId)) return null;
  const byId = await orderBy(ctx, "id", orderId);
  return byId && (byId.stripe_checkout_session_id === null || byId.stripe_checkout_session_id === sessionId) ? byId : null;
}

/** Inserts an order; on a unique clash (a racing delivery made it first) reads that one back. */
async function insertOrder(ctx: Ctx, row: MoneyTables["orders"]["Insert"], uniqueBy: "stripe_checkout_session_id" | "stripe_subscription_id"): Promise<Order> {
  const inserted = await ctx.db.from("orders").insert(row).select("*").single();
  if (inserted.error?.code === "23505") {
    const existing = await orderBy(ctx, uniqueBy, String(row[uniqueBy]));
    if (existing) return existing;
  }
  const order = must(inserted, "order insert");
  if (!order) throw new Error("order insert returned nothing");
  return order;
}

type MoveState = "moved" | "resumed" | "settled";

/**
 * Moves an order with a conditional update, stamping `<status>_event_id`.
 * "resumed" when this same event already made the move (a retry), "settled"
 * when the move is not legal or another delivery got there first.
 */
async function moveOrder(
  ctx: Ctx,
  order: Order,
  to: OrderStatus,
  columns: Partial<Order>,
  metaPatch: Record<string, unknown> = {}
): Promise<MoveState> {
  const meta = metaOf(order.metadata);
  if (order.status === to && meta[`${to}_event_id`] === ctx.event.id) return "resumed";
  const move = transitionOrder(order.status, to);
  if (!move.ok || !move.changed) return "settled";
  const rows = must(
    await ctx.db
      .from("orders")
      .update({ ...columns, status: to, metadata: { ...meta, ...metaPatch, [`${to}_event_id`]: ctx.event.id } as Json })
      .eq("id", order.id)
      .eq("status", order.status)
      .select("id"),
    "order update"
  );
  return rows && rows.length > 0 ? "moved" : "settled";
}

async function moveInvoice(ctx: Ctx, invoice: Invoice, to: InvoiceStatus, columns: Partial<Invoice>): Promise<MoveState> {
  const meta = metaOf(invoice.metadata);
  if (invoice.status === to && meta[`${to}_event_id`] === ctx.event.id) return "resumed";
  const move = transitionInvoice(invoice.status, to);
  if (!move.ok || !move.changed) return "settled";
  const rows = must(
    await ctx.db
      .from("invoices")
      .update({ ...columns, status: to, metadata: { ...meta, [`${to}_event_id`]: ctx.event.id } as Json })
      .eq("id", invoice.id)
      .eq("status", invoice.status)
      .select("id"),
    "invoice update"
  );
  return rows && rows.length > 0 ? "moved" : "settled";
}

/** The first product on an order, for activity titles. */
async function orderLabel(ctx: Ctx, orderId: string): Promise<string | null> {
  const items = must(await ctx.db.from("order_items").select("product_id").eq("order_id", orderId).limit(1), "order items");
  const productId = items?.[0]?.product_id;
  if (!productId) return null;
  const product = must(await ctx.db.from("products").select("name").eq("id", productId).maybeSingle(), "product");
  return product?.name ?? null;
}

async function stampLead(ctx: Ctx, table: "orders" | "invoices", row: { id: string; lead_id: string | null }, lead: Lead | null) {
  if (!lead || row.lead_id) return;
  must(await ctx.db.from(table).update({ lead_id: lead.id }).eq("id", row.id), `${table} lead`);
}

// ── checkout ─────────────────────────────────────────────────────────────────

async function checkoutPaid(ctx: Ctx, plan: Extract<MoneyPlan, { kind: "checkout_paid" }>): Promise<ApplyResult> {
  let order = await orderForSession(ctx, plan.sessionId, plan.orderId);
  if (!order) {
    // Paid through a Payment Link or a session this Home did not create: it
    // is still a sale, so it gets an order.
    order = await insertOrder(
      ctx,
      {
        email: plan.email,
        status: "pending",
        total_minor: plan.amountMinor,
        currency: plan.currency,
        stripe_checkout_session_id: plan.sessionId,
        livemode: typeof ctx.event.livemode === "boolean" ? ctx.event.livemode : null,
        metadata: { source: "stripe", product_slug: plan.productSlug } as Json,
      },
      "stripe_checkout_session_id"
    );
  }

  const state = await moveOrder(ctx, order, orderTarget(plan)!, {
    paid_at: plan.trial ? null : plan.paidAt,
    email: order.email || plan.email,
    total_minor: plan.amountMinor,
    currency: plan.currency,
    stripe_checkout_session_id: plan.sessionId,
    stripe_payment_intent_id: plan.paymentIntentId,
    stripe_subscription_id: plan.subscriptionId,
    livemode: typeof ctx.event.livemode === "boolean" ? ctx.event.livemode : order.livemode,
  });
  if (state === "settled") return { summary: `order ${order.id} is already ${order.status}; left alone`, orderId: order.id };

  const label = (await orderLabel(ctx, order.id)) ?? plan.productSlug;
  const effect = leadEffects(plan, { name: label, price: formatMinor(plan.amountMinor, plan.currency, { exact: true }) });
  const lead = effect ? await applyLeadEffect(ctx, effect, order.lead_id) : null;
  await stampLead(ctx, "orders", order, lead);

  // home_events: payment.received — emit { order_id, lead_id, amount_minor, currency } here once the events feed lands.

  const onboarding = lead && effect?.onboard ? await onboard(ctx, lead) : null;
  const what = plan.trial ? "trial started" : plan.free ? "free checkout" : "paid";
  return { summary: `order ${order.id} ${what}${state === "resumed" ? " (resumed)" : ""}`, orderId: order.id, leadId: lead?.id ?? null, onboarding };
}

async function checkoutFailed(ctx: Ctx, plan: Extract<MoneyPlan, { kind: "checkout_failed" }>): Promise<ApplyResult> {
  const order = await orderForSession(ctx, plan.sessionId, plan.orderId);
  if (!order) return { summary: `${plan.reason === "expired" ? "expired" : "failed"} session has no order` };
  const state = await moveOrder(ctx, order, "void", { stripe_checkout_session_id: plan.sessionId }, { void_reason: plan.reason });
  if (state === "settled") return { summary: `order ${order.id} is ${order.status}; left alone`, orderId: order.id };
  return { summary: `order ${order.id} void (${plan.reason === "expired" ? "checkout expired" : "payment failed"})`, orderId: order.id };
}

// ── invoices ─────────────────────────────────────────────────────────────────

/** metadata.order_id on a subscription, from Stripe. Throws on anything but a clean answer or a 404. */
async function subscriptionOrderId(ctx: Ctx, subscriptionId: string): Promise<string | null> {
  if (!stripeReady(ctx)) return null;
  const sub = await retrieveSubscription(subscriptionId, ctx.deps.stripe);
  if (!sub.ok) {
    if (sub.status === 404) return null;
    throw new Error(`subscription lookup failed: ${sub.error}`);
  }
  return sub.data.metadata?.order_id ?? null;
}

async function invoicePaid(ctx: Ctx, plan: Extract<MoneyPlan, { kind: "invoice_paid" }>): Promise<ApplyResult> {
  const price = formatMinor(plan.amountMinor, plan.currency, { exact: true });

  // 1. A Home invoice.
  let invoice = must(
    await ctx.db.from("invoices").select("*").eq("stripe_invoice_id", plan.stripeInvoiceId).maybeSingle(),
    "invoice lookup"
  );
  if (!invoice && isUuid(plan.homeInvoiceId)) {
    const byId = must(await ctx.db.from("invoices").select("*").eq("id", plan.homeInvoiceId).maybeSingle(), "invoice lookup");
    if (byId && (byId.stripe_invoice_id === null || byId.stripe_invoice_id === plan.stripeInvoiceId)) invoice = byId;
  }
  if (invoice) {
    const state = await moveInvoice(ctx, invoice, invoiceTarget(plan)!, {
      paid_at: plan.paidAt,
      stripe_invoice_id: plan.stripeInvoiceId,
      hosted_url: plan.hostedUrl ?? invoice.hosted_url,
      pdf_url: plan.pdfUrl ?? invoice.pdf_url,
    });
    if (state === "settled") return { summary: `invoice ${invoice.number} is ${invoice.status}; left alone`, invoiceId: invoice.id };
    const effect = leadEffects(plan, { name: null, price });
    const lead = effect ? await applyLeadEffect(ctx, effect, invoice.lead_id) : null;
    await stampLead(ctx, "invoices", invoice, lead);

    // home_events: payment.received — emit { invoice_id, lead_id, amount_minor, currency } here once the events feed lands.

    const onboarding = lead && effect?.onboard ? await onboard(ctx, lead) : null;
    return { summary: `invoice ${invoice.number} paid`, invoiceId: invoice.id, leadId: lead?.id ?? null, onboarding };
  }

  // 2. A one-off invoice raised in the Stripe dashboard.
  if (!plan.subscriptionId) {
    const effect = leadEffects(plan, { price });
    if (!effect) return { summary: "$0 invoice; nothing to record" };
    const lead = await applyLeadEffect(ctx, effect, null);
    if (!lead) return { summary: "invoice paid with no email to attach it to" };

    // home_events: payment.received — emit { stripe_invoice_id, lead_id, amount_minor, currency } here once the events feed lands.

    const onboarding = effect.onboard ? await onboard(ctx, lead) : null;
    return { summary: "stripe invoice paid (no Home invoice)", leadId: lead.id, onboarding };
  }

  // 3. A subscription's invoice.
  let order = await orderBy(ctx, "stripe_subscription_id", plan.subscriptionId);
  let context: "none" | "trial" | "active";
  if (!order) {
    const homeOrderId = plan.subscriptionOrderId ?? (await subscriptionOrderId(ctx, plan.subscriptionId));
    if (isUuid(homeOrderId) && (await orderBy(ctx, "id", homeOrderId))) {
      // Bought through Home checkout, but checkout.session.completed has not
      // been applied yet: wait for it rather than record the sale twice.
      throw new NotYet(`invoice for subscription ${plan.subscriptionId} arrived before its checkout`);
    }
    // A subscription the Home has never seen: made in the Stripe dashboard or
    // a Payment Link. Record it now.
    order = await insertOrder(
      ctx,
      {
        email: plan.email,
        status: "pending",
        total_minor: plan.amountMinor,
        currency: plan.currency,
        stripe_subscription_id: plan.subscriptionId,
        livemode: typeof ctx.event.livemode === "boolean" ? ctx.event.livemode : null,
        metadata: { source: "stripe_subscription", first_invoice: plan.stripeInvoiceId } as Json,
      },
      "stripe_subscription_id"
    );
    context = "none";
  } else if (order.status === "pending") {
    if (metaOf(order.metadata).source !== "stripe_subscription") {
      throw new NotYet(`invoice for subscription ${plan.subscriptionId} arrived before its checkout`);
    }
    context = "none"; // this flow made the order on an earlier attempt: resume
  } else {
    context = order.status === "trial" ? "trial" : "active";
  }

  if (context === "active" && plan.billingReason === "subscription_create") {
    return { summary: "first subscription invoice; the checkout recorded it", orderId: order.id };
  }

  const target: OrderStatus | null = context === "active" ? null : plan.amountMinor === 0 ? "trial" : "paid";
  if (target) {
    const state = await moveOrder(ctx, order, target, {
      paid_at: target === "paid" ? plan.paidAt : null,
      email: order.email || plan.email,
      total_minor: plan.amountMinor,
    });
    if (state === "settled") return { summary: `order ${order.id} is already ${order.status}; left alone`, orderId: order.id };
  }

  const effect = leadEffects(plan, { name: await orderLabel(ctx, order.id), price }, { subscriptionOrder: context });
  const lead = effect ? await applyLeadEffect(ctx, effect, order.lead_id) : null;
  await stampLead(ctx, "orders", order, lead);

  // home_events: payment.received — emit { order_id, lead_id, amount_minor, currency } here once the events feed lands.

  const onboarding = lead && effect?.onboard ? await onboard(ctx, lead) : null;
  const what = context === "active" ? "renewal recorded" : target === "trial" ? "trial recorded" : "subscription paid";
  return { summary: `order ${order.id} ${what}`, orderId: order.id, leadId: lead?.id ?? null, onboarding };
}

// ── refunds ──────────────────────────────────────────────────────────────────

async function chargeRefunded(ctx: Ctx, plan: Extract<MoneyPlan, { kind: "charge_refunded" }>): Promise<ApplyResult> {
  const price = formatMinor(plan.refundedMinor, plan.currency, { exact: true });
  let order = plan.paymentIntentId ? await orderBy(ctx, "stripe_payment_intent_id", plan.paymentIntentId) : null;
  let invoice: Invoice | null = null;

  // A subscription's charge pays an invoice, not a checkout: find the
  // invoice (named on the charge in older API versions, through
  // invoice_payments in newer ones), then its subscription, then the order.
  if (!order) {
    let invoiceId = plan.invoiceId;
    if (!invoiceId && plan.paymentIntentId && stripeReady(ctx)) {
      const found = await invoiceForPaymentIntent(plan.paymentIntentId, ctx.deps.stripe);
      if (!found.ok && found.status !== 404) throw new Error(`invoice lookup failed: ${found.error}`);
      invoiceId = found.ok ? found.data : null;
    }
    if (invoiceId) {
      invoice = must(await ctx.db.from("invoices").select("*").eq("stripe_invoice_id", invoiceId).maybeSingle(), "invoice lookup");
      if (!invoice && stripeReady(ctx)) {
        const inv = await retrieveInvoice(invoiceId, ctx.deps.stripe);
        if (!inv.ok && inv.status !== 404) throw new Error(`invoice lookup failed: ${inv.error}`);
        const subscriptionId = inv.ok ? invoiceSubscriptionId(inv.data) : null;
        if (subscriptionId) {
          order = await orderBy(ctx, "stripe_subscription_id", subscriptionId);
          // A subscription bought through Home checkout whose checkout has not
          // been applied yet: its order exists but carries no subscription id.
          const homeOrderId = order ? null : await subscriptionOrderId(ctx, subscriptionId);
          if (isUuid(homeOrderId) && (await orderBy(ctx, "id", homeOrderId))) {
            throw new NotYet(`refund on subscription ${subscriptionId} arrived before its checkout`);
          }
        }
      }
    }
  }

  // A refund of a Home checkout whose payment has not been applied yet.
  if (!order && !invoice && plan.paymentIntentId && stripeReady(ctx)) {
    const pi = await retrievePaymentIntent(plan.paymentIntentId, ctx.deps.stripe);
    if (!pi.ok && pi.status !== 404) throw new Error(`payment lookup failed: ${pi.error}`);
    const homeId = pi.ok ? pi.data.metadata?.order_id : null;
    if (isUuid(homeId) && (await orderBy(ctx, "id", homeId))?.status === "pending") {
      throw new NotYet(`refund of order ${homeId} arrived before its payment`);
    }
  }

  if (order) {
    if (order.status === "pending") throw new NotYet(`refund of order ${order.id} arrived before its payment`);
    const meta = metaOf(order.metadata);
    const refunded = refundedSoFar(meta.refunded_minor, plan.refundedMinor);
    if (plan.full) {
      const state = await moveOrder(ctx, order, "refunded", {}, { refunded_minor: refunded });
      if (state === "settled") return { summary: `order ${order.id} is ${order.status}; left alone`, orderId: order.id };
    } else {
      if (order.status === "refunded") return { summary: `order ${order.id} is already fully refunded`, orderId: order.id };
      await recordPartialRefund(ctx, "orders", order, refunded);
    }
    const effect = leadEffects(plan, { name: await orderLabel(ctx, order.id), price })!;
    const lead = await applyLeadEffect(ctx, effect, order.lead_id);
    return { summary: `order ${order.id} ${plan.full ? "refunded" : "partly refunded"}`, orderId: order.id, leadId: lead?.id ?? null };
  }

  if (invoice) {
    await recordPartialRefund(ctx, "invoices", invoice, refundedSoFar(metaOf(invoice.metadata).refunded_minor, plan.refundedMinor));
    const lead = await applyLeadEffect(ctx, leadEffects(plan, { name: invoice.number, price })!, invoice.lead_id);
    return { summary: `invoice ${invoice.number} ${plan.full ? "refunded" : "partly refunded"}`, invoiceId: invoice.id, leadId: lead?.id ?? null };
  }

  // Not a sale the Home knows: note it on an existing lead, never make one.
  const lead = await applyLeadEffect(ctx, leadEffects(plan, { price })!, null);
  return { summary: lead ? "refund noted on the lead (no order)" : "refund matches no order or lead", leadId: lead?.id ?? null };
}

/**
 * Writes refunded_minor only where the row still holds what was read (its
 * status and its refunded_minor), so two refund events racing can never
 * lower the amount or overwrite a move the other made. Losing the race
 * throws NotYet: the event stays unprocessed and the redelivery re-reads.
 */
async function recordPartialRefund(
  ctx: Ctx,
  table: "orders" | "invoices",
  row: { id: string; status: string; metadata: Json },
  refunded: number
): Promise<void> {
  const meta = metaOf(row.metadata);
  if (meta.refunded_minor === refunded) return; // already recorded (a retry)
  const before = typeof meta.refunded_minor === "number" ? String(meta.refunded_minor) : null;
  let update = ctx.db
    .from(table)
    .update({ metadata: { ...meta, refunded_minor: refunded } as Json })
    .eq("id", row.id)
    .eq("status", row.status as never);
  update = before === null ? update.is("metadata->>refunded_minor", null) : update.eq("metadata->>refunded_minor", before);
  const rows = must(await update.select("id"), `${table} refund`);
  if (!rows || rows.length === 0) throw new NotYet(`${table} ${row.id} changed while recording a refund; retrying`);
}

// ── subscriptions ────────────────────────────────────────────────────────────

async function subscriptionEnded(ctx: Ctx, plan: Extract<MoneyPlan, { kind: "subscription_ended" }>): Promise<ApplyResult> {
  const order = await orderBy(ctx, "stripe_subscription_id", plan.subscriptionId);
  if (!order) return { summary: "ended subscription matches no order" };

  const ended = { status: "canceled", ended_at: plan.endedAt };
  if (order.status === "trial") {
    await moveOrder(ctx, order, "void", {}, { subscription: ended, void_reason: "trial_ended" });
  } else {
    must(
      await ctx.db
        .from("orders")
        .update({ metadata: { ...metaOf(order.metadata), subscription: ended } as Json })
        .eq("id", order.id),
      "order subscription"
    );
  }
  const effect = leadEffects(plan, { name: await orderLabel(ctx, order.id) })!;
  const lead = await applyLeadEffect(ctx, effect, order.lead_id);
  return { summary: `subscription ${plan.subscriptionId} ended`, orderId: order.id, leadId: lead?.id ?? null };
}

// ── the lead ─────────────────────────────────────────────────────────────────

function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, "\\$&");
}

/**
 * The lead the record already points at, else the buyer by email (created
 * only when the effect allows, with triggers off). Then tags, tag_added for
 * each new tag, converted status, and one timeline entry for this event.
 */
async function applyLeadEffect(ctx: Ctx, effect: LeadEffect, knownLeadId: string | null): Promise<Lead | null> {
  let lead: Lead | null = null;
  if (knownLeadId) {
    lead = must(await ctx.db.from("leads").select("*").eq("id", knownLeadId).maybeSingle(), "lead lookup") as Lead | null;
  }
  const email = effect.email?.trim().toLowerCase() || "";
  if (!lead && EMAIL_RE.test(email)) {
    lead = must(
      await ctx.db.from("leads").select("*").ilike("email", escapeLike(email)).limit(1).maybeSingle(),
      "lead lookup"
    ) as Lead | null;
    if (!lead && effect.createLead) {
      const made = await ctx.deps.upsertLead(ctx.db, { email, name: effect.name, source: "stripe" }, { actor: ACTOR, fireTriggers: false });
      lead = made.lead;
    }
  }
  if (!lead) return null;

  const before = lead.tags || [];
  const tags = applyTagChanges(before, effect.addTags, effect.removeTags);
  const added = tags.filter((t) => !before.includes(t));
  const converting = effect.convert && lead.status !== "converted";
  const patch: Partial<Lead> = {};
  if (tags.length !== before.length || added.length > 0) patch.tags = tags;
  if (converting) patch.status = "converted";
  if (Object.keys(patch).length > 0) {
    must(await ctx.db.from("leads").update(patch).eq("id", lead.id), "lead update");
    lead = { ...lead, ...patch };
  }
  for (const tag of added) await ctx.deps.fireTrigger(ctx.db, { type: "tag_added", lead, data: { tag } });
  if (converting) await ctx.deps.fireTrigger(ctx.db, { type: "status_changed", lead, data: { status: "converted" } });

  await addTimelineEntry(ctx.db, { ...effect.activity, lead_id: lead.id, actor: ACTOR, event_id: ctx.event.id });
  return lead;
}

function settingRef(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") {
    const v = value as { id?: unknown; name?: unknown };
    return String(v.id ?? v.name ?? "").trim();
  }
  return "";
}

/** Resolves backend_settings.money_onboarding_workflow to an active workflow. */
export async function onboardingWorkflow(
  db: MoneyClient
): Promise<{ ref: string; workflow: Workflow | null; status: string | null }> {
  const ref = settingRef(await readSetting(db, ONBOARDING_SETTING));
  if (!ref) return { ref, workflow: null, status: null };
  // Read whatever the setting names, then decide: only an active workflow
  // enrols, but a draft (the seeded recipe the owner has not enabled yet) is
  // a known state, not a failure.
  const query = db.from("workflows").select("*");
  const row = must(
    isUuid(ref) ? await query.eq("id", ref).maybeSingle() : await query.eq("name", ref).limit(1).maybeSingle(),
    "onboarding workflow"
  ) as Workflow | null;
  const status = row?.status ?? null;
  return { ref, workflow: row && status === "active" ? row : null, status };
}

/**
 * Enrols the lead in the onboarding workflow. A workflow that cannot be
 * found, or an enrolment that fails for any reason but the workflow's own
 * re-enrolment rules, is logged and written on the lead's timeline, so the
 * owner sees it; it never fails the payment.
 */
async function onboard(ctx: Ctx, lead: Lead): Promise<{ enrolled: boolean; reason?: string }> {
  const { ref, workflow, status } = await onboardingWorkflow(ctx.db);
  if (!ref) return { enrolled: false, reason: "no onboarding workflow is set" };
  if (!workflow && status === "draft") {
    // The seeded recipe, not yet enabled by the owner: say so once per event
    // in the result, without an error or a timeline entry on every payment.
    console.warn(`money onboarding: workflow "${ref}" is still a draft; enable it to start onboarding`);
    return { enrolled: false, reason: "onboarding workflow is still a draft" };
  }

  let result: { enrolled: boolean; reason?: string };
  if (!workflow) {
    result = { enrolled: false, reason: `onboarding workflow "${ref}" is not an active workflow` };
  } else {
    try {
      result = await ctx.deps.enrollLead(ctx.db, workflow, lead, "money:onboarding");
    } catch (e) {
      result = { enrolled: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }
  if (!result.enrolled && !BENIGN_ENROL.includes(result.reason || "")) {
    console.error(`money onboarding for lead ${lead.id} failed: ${result.reason}`);
    await addTimelineEntry(ctx.db, {
      lead_id: lead.id,
      activity_type: "onboarding_failed",
      title: `Onboarding did not start: ${result.reason}`,
      data: { workflow: ref },
      actor: ACTOR,
      event_id: ctx.event.id,
    });
  }
  return result;
}
