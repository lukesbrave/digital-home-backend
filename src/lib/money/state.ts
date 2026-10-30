/**
 * Money state — the pure half of the Stripe webhook. No framework imports.
 *
 * planStripeEvent reads a Stripe event and says what it means for the Home
 * (a MoneyPlan). transitionOrder / transitionInvoice say which status moves
 * are legal. leadEffects says what the plan does to the buyer's lead. The
 * database half that carries a plan out is ./apply.ts.
 *
 * Only ids the Home itself wrote are trusted to find a record: the session,
 * payment and subscription ids, and metadata.order_id / home_invoice_id,
 * which the Home sets server-side. client_reference_id is never used to find
 * an order: a Payment Link lets the buyer put anything there.
 *
 * Event payloads are read defensively: the shape moved between Stripe API
 * versions (invoice.subscription became invoice.parent.subscription_details
 * .subscription in 2025-03), so both are accepted.
 */

import type { InvoiceStatus, OrderStatus } from "../../types/database.ts";
import { normalizeCurrency, DEFAULT_CURRENCY } from "./money.ts";

export const HANDLED_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "invoice.paid",
  "charge.refunded",
  "customer.subscription.deleted",
] as const;

export type HandledEvent = (typeof HANDLED_EVENTS)[number];

/** The parts of a Stripe event this module reads. */
export interface StripeEventLike {
  id: string;
  type: string;
  created?: number;
  livemode?: boolean;
  data?: { object?: Record<string, unknown> };
}

export type MoneyPlan =
  | { kind: "ignore"; reason: string }
  | {
      kind: "checkout_paid";
      sessionId: string;
      orderId: string | null;
      productSlug: string | null;
      email: string | null;
      name: string | null;
      amountMinor: number;
      currency: string;
      paymentIntentId: string | null;
      subscriptionId: string | null;
      /** A subscription that charged nothing up front: a free trial. */
      trial: boolean;
      /** Nothing was charged and nothing will recur (a 100% coupon, a free product). */
      free: boolean;
      paidAt: string;
    }
  | { kind: "checkout_failed"; sessionId: string; orderId: string | null; reason: "expired" | "payment_failed" }
  | {
      kind: "invoice_paid";
      stripeInvoiceId: string;
      homeInvoiceId: string | null;
      number: string | null;
      email: string | null;
      name: string | null;
      amountMinor: number;
      currency: string;
      subscriptionId: string | null;
      /** metadata.order_id carried on the subscription, when the payload includes it. */
      subscriptionOrderId: string | null;
      billingReason: string | null;
      paidAt: string;
      hostedUrl: string | null;
      pdfUrl: string | null;
    }
  | {
      kind: "charge_refunded";
      chargeId: string;
      paymentIntentId: string | null;
      /** The invoice the charge paid (older API versions only). */
      invoiceId: string | null;
      amountMinor: number;
      refundedMinor: number;
      full: boolean;
      currency: string;
      email: string | null;
    }
  | { kind: "subscription_ended"; subscriptionId: string; orderId: string | null; endedAt: string };

// ── reading payloads ─────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;

function obj(value: unknown): Obj {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** A Stripe reference is either an id string or an expanded object with .id. */
function ref(value: unknown): string | null {
  return str(value) ?? str(obj(value).id);
}

function int(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0;
}

function iso(seconds: unknown, fallbackSeconds?: number): string {
  const s = typeof seconds === "number" && seconds > 0 ? seconds : fallbackSeconds;
  return new Date((s && s > 0 ? s : Date.now() / 1000) * 1000).toISOString();
}

function currencyOf(value: unknown): string {
  return normalizeCurrency(value) || DEFAULT_CURRENCY;
}

// ── planning ─────────────────────────────────────────────────────────────────

export function isHandledEvent(type: string): type is HandledEvent {
  return (HANDLED_EVENTS as readonly string[]).includes(type);
}

export function planStripeEvent(event: StripeEventLike): MoneyPlan {
  if (!isHandledEvent(event.type)) return { kind: "ignore", reason: `not handled: ${event.type}` };
  const o = obj(event.data?.object);
  const id = str(o.id);
  if (!id) return { kind: "ignore", reason: "event has no object id" };
  const meta = obj(o.metadata);

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      // A bank debit or voucher completes the session before the money
      // arrives; async_payment_succeeded (or _failed) follows when it does.
      if (event.type === "checkout.session.completed" && o.payment_status === "unpaid") {
        return { kind: "ignore", reason: "checkout completed, payment still pending" };
      }
      const details = obj(o.customer_details);
      const amountMinor = int(o.amount_total);
      const subscriptionId = ref(o.subscription);
      return {
        kind: "checkout_paid",
        sessionId: id,
        orderId: str(meta.order_id),
        productSlug: str(meta.product_slug),
        email: str(details.email) ?? str(o.customer_email),
        name: str(details.name),
        amountMinor,
        currency: currencyOf(o.currency),
        paymentIntentId: ref(o.payment_intent),
        subscriptionId,
        trial: !!subscriptionId && amountMinor === 0,
        free: !subscriptionId && amountMinor === 0,
        paidAt: iso(event.created, int(o.created)),
      };
    }
    case "checkout.session.async_payment_failed":
      return { kind: "checkout_failed", sessionId: id, orderId: str(meta.order_id), reason: "payment_failed" };
    case "checkout.session.expired":
      return { kind: "checkout_failed", sessionId: id, orderId: str(meta.order_id), reason: "expired" };

    case "invoice.paid": {
      const parentSub = obj(obj(o.parent).subscription_details);
      const oldSub = obj(o.subscription_details);
      const transitions = obj(o.status_transitions);
      return {
        kind: "invoice_paid",
        stripeInvoiceId: id,
        homeInvoiceId: str(meta.home_invoice_id),
        number: str(o.number),
        email: str(o.customer_email),
        name: str(o.customer_name),
        amountMinor: int(o.amount_paid),
        currency: currencyOf(o.currency),
        subscriptionId: ref(o.subscription) ?? ref(parentSub.subscription),
        subscriptionOrderId: str(obj(parentSub.metadata).order_id) ?? str(obj(oldSub.metadata).order_id),
        billingReason: str(o.billing_reason),
        paidAt: iso(transitions.paid_at, event.created),
        hostedUrl: str(o.hosted_invoice_url),
        pdfUrl: str(o.invoice_pdf),
      };
    }
    case "charge.refunded": {
      const amount = int(o.amount);
      const refunded = int(o.amount_refunded);
      return {
        kind: "charge_refunded",
        chargeId: id,
        paymentIntentId: ref(o.payment_intent),
        invoiceId: ref(o.invoice),
        amountMinor: amount,
        refundedMinor: refunded,
        full: o.refunded === true || (amount > 0 && refunded >= amount),
        currency: currencyOf(o.currency),
        email: str(obj(o.billing_details).email) ?? str(o.receipt_email),
      };
    }
    case "customer.subscription.deleted":
      return {
        kind: "subscription_ended",
        subscriptionId: id,
        orderId: str(meta.order_id),
        endedAt: iso(o.ended_at ?? o.canceled_at, event.created),
      };
  }
}

/** True for an event Stripe sent from test mode. Events without the flag count as live. */
export function isTestModeEvent(event: StripeEventLike): boolean {
  return event.livemode === false;
}

// ── status transitions ───────────────────────────────────────────────────────

export type Transition<S> = { ok: true; status: S; changed: boolean } | { ok: false; reason: string };

const ORDER_MOVES: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ["paid", "trial", "void"],
  trial: ["paid", "void"],
  paid: ["refunded"],
  refunded: [],
  void: [],
};

const INVOICE_MOVES: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  draft: ["sent", "paid", "void"],
  sent: ["paid", "void"],
  paid: [],
  void: [],
};

function transition<S extends string>(moves: Record<S, readonly S[]>, from: S, to: S): Transition<S> {
  if (from === to) return { ok: true, status: to, changed: false };
  if (moves[from]?.includes(to)) return { ok: true, status: to, changed: true };
  return { ok: false, reason: `cannot move from ${from} to ${to}` };
}

/** Same-status is a no-op (a replay); refunded and void are final. */
export function transitionOrder(from: OrderStatus, to: OrderStatus): Transition<OrderStatus> {
  return transition(ORDER_MOVES, from, to);
}

/** Same-status is a no-op; paid and void are final. */
export function transitionInvoice(from: InvoiceStatus, to: InvoiceStatus): Transition<InvoiceStatus> {
  return transition(INVOICE_MOVES, from, to);
}

/** Where a plan moves the order it touches, or null when it leaves the status alone. */
export function orderTarget(plan: MoneyPlan): OrderStatus | null {
  switch (plan.kind) {
    case "checkout_paid":
      return plan.trial ? "trial" : "paid";
    case "checkout_failed":
      return "void";
    case "charge_refunded":
      return plan.full ? "refunded" : null; // a partial refund leaves the order paid
    default:
      return null;
  }
}

export function invoiceTarget(plan: MoneyPlan): InvoiceStatus | null {
  return plan.kind === "invoice_paid" ? "paid" : null;
}

/** A later, smaller partial refund never lowers what was already recorded. */
export function refundedSoFar(recorded: unknown, incoming: number): number {
  const before = typeof recorded === "number" && Number.isFinite(recorded) ? recorded : 0;
  return Math.max(before, incoming);
}

// ── what happens to the lead ─────────────────────────────────────────────────

export const CUSTOMER_TAG = "customer";
export const SUBSCRIBER_TAG = "subscriber";
export const SUBSCRIPTION_ENDED_TAG = "subscription-ended";
export const TRIAL_TAG = "trial";
export const REFUNDED_TAG = "refunded";

export interface LeadEffect {
  /** Find the lead by this email; null means "the lead already on the record". */
  email: string | null;
  name: string | null;
  /** Create a lead for an email the CRM does not know. Never for a refund or a cancellation. */
  createLead: boolean;
  addTags: string[];
  removeTags: string[];
  /** Lead status → converted (a paying customer). */
  convert: boolean;
  /** Enrol the backend_settings.money_onboarding_workflow. */
  onboard: boolean;
  activity: { activity_type: string; title: string; data: Record<string, unknown> };
}

/** The effect of a first real payment: a converted customer, onboarded. */
function firstPayment(
  email: string | null,
  name: string | null,
  subscription: boolean,
  title: string,
  data: Record<string, unknown>
): LeadEffect {
  return {
    email,
    name,
    createLead: true,
    addTags: subscription ? [CUSTOMER_TAG, SUBSCRIBER_TAG] : [CUSTOMER_TAG],
    removeTags: subscription ? [SUBSCRIPTION_ENDED_TAG, TRIAL_TAG] : [],
    convert: true,
    onboard: true,
    activity: { activity_type: "payment_received", title, data },
  };
}

/**
 * `label` is the product or invoice name for the activity title; `price` its
 * formatted amount. `context` says what the Home already knows: an invoice
 * paid on a subscription the Home recorded as a trial is that trial
 * converting, and a renewal is only a payment. Null for plans that touch no
 * lead (a failed or expired checkout).
 */
export function leadEffects(
  plan: MoneyPlan,
  label?: { name?: string | null; price?: string | null },
  context: { subscriptionOrder?: "none" | "trial" | "active" } = {}
): LeadEffect | null {
  const what = label?.name ? ` — ${label.name}` : "";
  const price = label?.price ? ` ${label.price}` : "";
  switch (plan.kind) {
    case "checkout_paid": {
      const data = { checkout_session_id: plan.sessionId, subscription_id: plan.subscriptionId, amount_minor: plan.amountMinor, currency: plan.currency };
      if (plan.trial) {
        return {
          email: plan.email,
          name: plan.name,
          createLead: true,
          addTags: [TRIAL_TAG],
          removeTags: [SUBSCRIPTION_ENDED_TAG],
          convert: false,
          onboard: false,
          activity: { activity_type: "trial_started", title: `Started a trial${what}`, data },
        };
      }
      if (plan.free) {
        return {
          email: plan.email,
          name: plan.name,
          createLead: true,
          addTags: [],
          removeTags: [],
          convert: false,
          onboard: false,
          activity: { activity_type: "free_checkout", title: `Free checkout${what}`, data },
        };
      }
      return firstPayment(plan.email, plan.name, !!plan.subscriptionId, `Paid${price}${what}`, data);
    }
    case "invoice_paid": {
      // A $0 invoice (a trial's first) moves no money and changes no one.
      if (plan.amountMinor === 0) return null;
      const data = { stripe_invoice_id: plan.stripeInvoiceId, billing_reason: plan.billingReason, amount_minor: plan.amountMinor, currency: plan.currency };
      const subscriptionInvoice = !!plan.subscriptionId || (plan.billingReason || "").startsWith("subscription");
      if (!subscriptionInvoice) {
        return firstPayment(plan.email, plan.name, false, `Invoice paid${price}${plan.number ? ` (${plan.number})` : ""}${what}`, data);
      }
      // A subscription the Home has never seen (made in the Stripe dashboard
      // or a Payment Link), or a trial's first real charge: a new customer.
      if (context.subscriptionOrder === "trial" || (context.subscriptionOrder === "none" && plan.billingReason === "subscription_create")) {
        return firstPayment(plan.email, plan.name, true, `Paid${price}${what}`, data);
      }
      return {
        email: plan.email,
        name: plan.name,
        createLead: true,
        addTags: [CUSTOMER_TAG, SUBSCRIBER_TAG],
        removeTags: [],
        convert: true,
        onboard: false, // a renewal: they were onboarded when they first paid
        activity: { activity_type: "payment_received", title: `Subscription payment${price}${what}`, data },
      };
    }
    case "charge_refunded":
      return {
        email: plan.email,
        name: null,
        createLead: false,
        addTags: plan.full ? [REFUNDED_TAG] : [],
        removeTags: [],
        convert: false,
        onboard: false,
        activity: {
          activity_type: "payment_refunded",
          title: `${plan.full ? "Refunded" : "Partly refunded"}${price}${what}`,
          data: { charge_id: plan.chargeId, refunded_minor: plan.refundedMinor, amount_minor: plan.amountMinor, currency: plan.currency },
        },
      };
    case "subscription_ended":
      return {
        email: null,
        name: null,
        createLead: false,
        addTags: [SUBSCRIPTION_ENDED_TAG],
        removeTags: [SUBSCRIBER_TAG, TRIAL_TAG],
        convert: false,
        onboard: false,
        activity: {
          activity_type: "subscription_ended",
          title: `Subscription ended${what}`,
          data: { subscription_id: plan.subscriptionId, ended_at: plan.endedAt },
        },
      };
    default:
      return null;
  }
}

/** Tags after an effect: removals first, then additions, no duplicates, order kept. */
export function applyTagChanges(tags: readonly string[], add: readonly string[], remove: readonly string[]): string[] {
  const kept = tags.filter((t) => !remove.includes(t));
  for (const t of add) if (!kept.includes(t)) kept.push(t);
  return kept;
}

/** A deal counts as won when it is marked won or moved to a stage named "Won". */
export function isDealWon(input: { status?: string | null; stageName?: string | null }): boolean {
  return input.status === "won" || (input.stageName || "").trim().toLowerCase() === "won";
}
