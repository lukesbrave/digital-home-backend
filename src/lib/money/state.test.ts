import assert from "node:assert/strict";
import test from "node:test";
import {
  applyTagChanges,
  invoiceTarget,
  isDealWon,
  isTestModeEvent,
  refundedSoFar,
  leadEffects,
  orderTarget,
  planStripeEvent,
  transitionInvoice,
  transitionOrder,
  type MoneyPlan,
} from "./state.ts";

const T = 1_761_500_000;

const ev = (type: string, object: Record<string, unknown>) => ({ id: `evt_${type}`, type, created: T, data: { object } });

const paidCheckout = ev("checkout.session.completed", {
  id: "cs_test_1",
  mode: "payment",
  payment_status: "paid",
  customer_details: { email: "Buyer@Example.com", name: "Bea Buyer" },
  amount_total: 4900,
  currency: "aud",
  payment_intent: "pi_1",
  subscription: null,
  client_reference_id: "11111111-1111-4111-8111-111111111111",
  metadata: { order_id: "11111111-1111-4111-8111-111111111111", product_slug: "strategy-session" },
});

// ── planning ─────────────────────────────────────────────────────────────────

test("checkout.session.completed (paid) plans a paid checkout", () => {
  const plan = planStripeEvent(paidCheckout);
  assert.deepEqual(plan, {
    kind: "checkout_paid",
    sessionId: "cs_test_1",
    orderId: "11111111-1111-4111-8111-111111111111",
    productSlug: "strategy-session",
    email: "Buyer@Example.com",
    name: "Bea Buyer",
    amountMinor: 4900,
    currency: "AUD",
    paymentIntentId: "pi_1",
    subscriptionId: null,
    trial: false,
    free: false,
    paidAt: new Date(T * 1000).toISOString(),
  });
});

test("client_reference_id never finds an order: a Payment Link lets the buyer set it", () => {
  const plan = planStripeEvent(ev("checkout.session.completed", { ...paidCheckout.data.object, metadata: {} }));
  assert.equal(plan.kind === "checkout_paid" && plan.orderId, null);
});

test("a $0 subscription checkout is a trial; a $0 one-off is free", () => {
  const trial = planStripeEvent(ev("checkout.session.completed", { ...paidCheckout.data.object, amount_total: 0, subscription: "sub_1", payment_status: "no_payment_required" }));
  const free = planStripeEvent(ev("checkout.session.completed", { ...paidCheckout.data.object, amount_total: 0, payment_status: "no_payment_required" }));
  assert.equal(trial.kind === "checkout_paid" && trial.trial, true);
  assert.equal(free.kind === "checkout_paid" && free.free, true);
  assert.equal(orderTarget(trial), "trial");
  assert.equal(orderTarget(free), "paid");
  const trialEffect = leadEffects(trial)!;
  assert.deepEqual(trialEffect.addTags, ["trial"]);
  assert.equal(trialEffect.convert || trialEffect.onboard, false);
  const freeEffect = leadEffects(free)!;
  assert.deepEqual(freeEffect.addTags, []);
  assert.equal(freeEffect.convert || freeEffect.onboard, false);
});

test("async payment failure plans a failed checkout", () => {
  const failed = planStripeEvent(ev("checkout.session.async_payment_failed", { id: "cs_9", metadata: { order_id: "o9" } }));
  assert.deepEqual(failed, { kind: "checkout_failed", sessionId: "cs_9", orderId: "o9", reason: "payment_failed" });
  assert.equal(orderTarget(failed), "void");
});

test("test-mode events are flagged", () => {
  assert.equal(isTestModeEvent({ id: "e", type: "x", livemode: false }), true);
  assert.equal(isTestModeEvent({ id: "e", type: "x", livemode: true }), false);
  assert.equal(isTestModeEvent({ id: "e", type: "x" }), false);
});

test("a checkout whose bank debit is still pending changes nothing until async_payment_succeeded", () => {
  const pending = ev("checkout.session.completed", { ...paidCheckout.data.object, payment_status: "unpaid" });
  assert.equal(planStripeEvent(pending).kind, "ignore");
  const succeeded = ev("checkout.session.async_payment_succeeded", { ...paidCheckout.data.object, payment_status: "paid" });
  assert.equal(planStripeEvent(succeeded).kind, "checkout_paid");
});

test("a subscription checkout carries the subscription; expanded objects read by id", () => {
  const plan = planStripeEvent(
    ev("checkout.session.completed", {
      ...paidCheckout.data.object,
      mode: "subscription",
      subscription: { id: "sub_1", object: "subscription" },
      payment_intent: null,
    })
  );
  assert.equal(plan.kind === "checkout_paid" && plan.subscriptionId, "sub_1");
  assert.equal(plan.kind === "checkout_paid" && plan.paymentIntentId, null);
});

test("invoice.paid reads both the old and the 2025 subscription shape", () => {
  const base = { id: "in_1", number: "ABC-0001", customer_email: "c@example.com", amount_paid: 120000, currency: "usd",
    status_transitions: { paid_at: T + 5 }, hosted_invoice_url: "https://invoice.stripe.com/i/x", invoice_pdf: "https://pay.stripe.com/x.pdf",
    metadata: { home_invoice_id: "22222222-2222-4222-8222-222222222222" } };
  const manual = planStripeEvent(ev("invoice.paid", { ...base, billing_reason: "manual" }));
  assert.equal(manual.kind, "invoice_paid");
  if (manual.kind !== "invoice_paid") return;
  assert.equal(manual.subscriptionId, null);
  assert.equal(manual.homeInvoiceId, "22222222-2222-4222-8222-222222222222");
  assert.equal(manual.currency, "USD");
  assert.equal(manual.paidAt, new Date((T + 5) * 1000).toISOString());

  const old = planStripeEvent(ev("invoice.paid", { ...base, subscription: "sub_old", subscription_details: { metadata: { order_id: "o_old" } } }));
  const basil = planStripeEvent(ev("invoice.paid", { ...base, parent: { subscription_details: { subscription: "sub_new", metadata: { order_id: "o_new" } } } }));
  assert.equal(old.kind === "invoice_paid" && old.subscriptionId, "sub_old");
  assert.equal(old.kind === "invoice_paid" && old.subscriptionOrderId, "o_old");
  assert.equal(basil.kind === "invoice_paid" && basil.subscriptionId, "sub_new");
  assert.equal(basil.kind === "invoice_paid" && basil.subscriptionOrderId, "o_new");
});

test("charge.refunded is full or partial", () => {
  const full = planStripeEvent(ev("charge.refunded", { id: "ch_1", payment_intent: "pi_1", invoice: "in_7", amount: 4900, amount_refunded: 4900, refunded: true, currency: "aud" }));
  assert.equal(full.kind === "charge_refunded" && full.invoiceId, "in_7");
  const part = planStripeEvent(ev("charge.refunded", { id: "ch_1", payment_intent: "pi_1", amount: 4900, amount_refunded: 1000, refunded: false, currency: "aud" }));
  assert.equal(full.kind === "charge_refunded" && full.full, true);
  assert.equal(part.kind === "charge_refunded" && part.full, false);
});

test("customer.subscription.deleted and checkout.session.expired", () => {
  const ended = planStripeEvent(ev("customer.subscription.deleted", { id: "sub_1", ended_at: T, metadata: { order_id: "o" } }));
  assert.deepEqual(ended, { kind: "subscription_ended", subscriptionId: "sub_1", orderId: "o", endedAt: new Date(T * 1000).toISOString() });
  const expired = planStripeEvent(ev("checkout.session.expired", { id: "cs_2", client_reference_id: "o2", metadata: { order_id: "o3" } }));
  assert.deepEqual(expired, { kind: "checkout_failed", sessionId: "cs_2", orderId: "o3", reason: "expired" });
});

test("unhandled types and objects without ids are ignored", () => {
  assert.equal(planStripeEvent(ev("payment_intent.created", { id: "pi_1" })).kind, "ignore");
  assert.equal(planStripeEvent(ev("invoice.paid", {})).kind, "ignore");
  assert.equal(planStripeEvent({ id: "evt_x", type: "invoice.paid" }).kind, "ignore");
});

// ── transitions ──────────────────────────────────────────────────────────────

test("orders: pending → paid | trial | void, trial → paid | void, paid → refunded; refunded and void are final", () => {
  assert.deepEqual(transitionOrder("pending", "paid"), { ok: true, status: "paid", changed: true });
  assert.equal(transitionOrder("pending", "trial").ok, true);
  assert.equal(transitionOrder("trial", "paid").ok, true);
  assert.equal(transitionOrder("trial", "void").ok, true);
  assert.equal(transitionOrder("paid", "trial").ok, false);
  assert.deepEqual(transitionOrder("pending", "void"), { ok: true, status: "void", changed: true });
  assert.deepEqual(transitionOrder("paid", "refunded"), { ok: true, status: "refunded", changed: true });
  assert.deepEqual(transitionOrder("paid", "paid"), { ok: true, status: "paid", changed: false }); // replay
  assert.equal(transitionOrder("paid", "void").ok, false);
  assert.equal(transitionOrder("paid", "pending").ok, false);
  assert.equal(transitionOrder("refunded", "paid").ok, false);
  assert.equal(transitionOrder("void", "paid").ok, false);
  assert.equal(transitionOrder("pending", "refunded").ok, false);
});

test("invoices: draft → sent | paid | void, sent → paid | void; paid and void are final", () => {
  assert.equal(transitionInvoice("draft", "sent").ok, true);
  assert.equal(transitionInvoice("draft", "paid").ok, true);
  assert.equal(transitionInvoice("sent", "paid").ok, true);
  assert.equal(transitionInvoice("sent", "void").ok, true);
  assert.deepEqual(transitionInvoice("paid", "paid"), { ok: true, status: "paid", changed: false });
  assert.equal(transitionInvoice("paid", "void").ok, false);
  assert.equal(transitionInvoice("void", "paid").ok, false);
  assert.equal(transitionInvoice("sent", "draft").ok, false);
});

test("each plan names the status it moves its order or invoice to", () => {
  const plans = (["checkout.session.completed", "checkout.session.expired", "invoice.paid", "customer.subscription.deleted"] as const).map(
    (type) => planStripeEvent(type === "checkout.session.completed" ? paidCheckout : ev(type, { id: "x_1" }))
  );
  assert.deepEqual(plans.map(orderTarget), ["paid", "void", null, null]);
  assert.deepEqual(plans.map(invoiceTarget), [null, null, "paid", null]);
  const full: Extract<MoneyPlan, { kind: "charge_refunded" }> = { kind: "charge_refunded", chargeId: "ch", paymentIntentId: "pi", invoiceId: null, amountMinor: 10, refundedMinor: 10, full: true, currency: "AUD", email: null };
  assert.equal(orderTarget(full), "refunded");
  assert.equal(orderTarget({ ...full, full: false }), null);
  assert.equal(refundedSoFar(4900, 1000), 4900); // a late partial never lowers a full refund
  assert.equal(refundedSoFar(undefined, 1000), 1000);
});

// ── leads ────────────────────────────────────────────────────────────────────

test("a paid checkout makes a converted customer and onboards them", () => {
  const effect = leadEffects(planStripeEvent(paidCheckout), { name: "Strategy session", price: "$49.00" })!;
  assert.deepEqual(effect.addTags, ["customer"]);
  assert.equal(effect.convert, true);
  assert.equal(effect.onboard, true);
  assert.equal(effect.email, "Buyer@Example.com");
  assert.equal(effect.activity.activity_type, "payment_received");
  assert.equal(effect.activity.title, "Paid $49.00 — Strategy session");
});

test("a subscription checkout adds subscriber and clears subscription-ended", () => {
  const plan = planStripeEvent(ev("checkout.session.completed", { ...paidCheckout.data.object, subscription: "sub_1" }));
  const effect = leadEffects(plan)!;
  assert.deepEqual(effect.addTags, ["customer", "subscriber"]);
  assert.deepEqual(effect.removeTags, ["subscription-ended", "trial"]);
});

test("invoice payments: one-offs and new subscriptions onboard, renewals and $0 invoices do not", () => {
  const manual = leadEffects(planStripeEvent(ev("invoice.paid", { id: "in_1", billing_reason: "manual", customer_email: "c@example.com", amount_paid: 100 })))!;
  const cycle = planStripeEvent(ev("invoice.paid", { id: "in_2", billing_reason: "subscription_cycle", subscription: "sub_1", amount_paid: 100 }));
  const renewal = leadEffects(cycle, undefined, { subscriptionOrder: "active" })!;
  const converting = leadEffects(cycle, undefined, { subscriptionOrder: "trial" })!;
  const foreign = leadEffects(planStripeEvent(ev("invoice.paid", { id: "in_3", billing_reason: "subscription_create", subscription: "sub_2", amount_paid: 100 })), undefined, { subscriptionOrder: "none" })!;
  assert.equal(manual.onboard, true);
  assert.equal(manual.convert, true);
  assert.equal(renewal.onboard, false);
  assert.match(renewal.activity.title, /^Subscription payment/);
  assert.equal(converting.onboard, true);
  assert.deepEqual(converting.removeTags, ["subscription-ended", "trial"]);
  assert.equal(foreign.onboard, true);
  assert.equal(leadEffects(planStripeEvent(ev("invoice.paid", { id: "in_4", amount_paid: 0 }))), null);
});

test("refunds tag refunded only when full; ending a subscription swaps the tags", () => {
  const full = leadEffects(planStripeEvent(ev("charge.refunded", { id: "ch", amount: 10, amount_refunded: 10, refunded: true })))!;
  const part = leadEffects(planStripeEvent(ev("charge.refunded", { id: "ch", amount: 10, amount_refunded: 3 })))!;
  assert.deepEqual(full.addTags, ["refunded"]);
  assert.deepEqual(part.addTags, []);
  assert.equal(full.convert || full.onboard || full.createLead, false);
  const ended = leadEffects(planStripeEvent(ev("customer.subscription.deleted", { id: "sub_1" })))!;
  assert.deepEqual(ended.addTags, ["subscription-ended"]);
  assert.deepEqual(ended.removeTags, ["subscriber", "trial"]);
  assert.equal(ended.email, null); // found through the order instead
  assert.equal(ended.createLead, false);
});

test("a deal is won by status or by a stage named Won", () => {
  assert.equal(isDealWon({ status: "won" }), true);
  assert.equal(isDealWon({ stageName: " Won " }), true);
  assert.equal(isDealWon({ stageName: "Proposal" }), false);
  assert.equal(isDealWon({ status: "lost", stageName: null }), false);
});

test("an expired checkout touches no lead", () => {
  assert.equal(leadEffects(planStripeEvent(ev("checkout.session.expired", { id: "cs" }))), null);
});

test("tag changes remove, then add, without duplicates", () => {
  assert.deepEqual(applyTagChanges(["vip", "subscriber"], ["subscription-ended", "vip"], ["subscriber"]), ["vip", "subscription-ended"]);
  assert.deepEqual(applyTagChanges([], ["customer"], []), ["customer"]);
});
