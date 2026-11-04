import assert from "node:assert/strict";
import test from "node:test";
import { createWebhookStore } from "./apply.ts";
import type { MoneyClient } from "./db.ts";
import type { MoneyDeps } from "./deps.ts";
import { fakeDb, type FakeDb } from "./fake-db.ts";
import { signPayload } from "./stripe-signature.ts";
import { handleStripeWebhook } from "./webhook.ts";

// Fabricated: not real secrets.
const SECRET = "whsec_fabricated_for_tests";
const NOW = 1_761_500_000;
const ORDER = "11111111-1111-4111-8111-111111111111";
const WORKFLOW = "22222222-2222-4222-8222-222222222222";
const PRODUCT = "33333333-3333-4333-8333-333333333333";

type Row = Record<string, unknown>;

function home(seed: Record<string, Row[]> = {}, opts: { enrolFails?: string; stripe?: MoneyDeps["stripe"] } = {}) {
  const db = fakeDb({
    products: [{ id: PRODUCT, slug: "strategy-session", name: "Strategy session", kind: "one_time", amount_minor: 4900, currency: "AUD" }],
    backend_settings: [{ key: "money_onboarding_workflow", value: "Customer onboarding" }],
    workflows: [{ id: WORKFLOW, name: "Customer onboarding", status: "active" }],
    ...seed,
  });
  const triggers: string[] = [];
  const enrolments: string[] = [];
  const upserts: Array<{ email: string; fireTriggers: false }> = [];
  const deps: MoneyDeps = {
    async upsertLead(_db, input, o) {
      assert.equal(o.fireTriggers, false, "payments never fire lead_created or form_submitted");
      upserts.push({ email: input.email, fireTriggers: o.fireTriggers });
      const { data } = await db.from("leads").insert({ email: input.email, first_name: input.name ?? null, source: input.source ?? null }).select("*").single();
      return { lead: data as never, created: true };
    },
    async fireTrigger(_db, event) {
      triggers.push(`${event.type}:${event.data.tag ?? event.data.status}`);
      return [];
    },
    async enrollLead(_db, workflow, lead) {
      if (opts.enrolFails) return { enrolled: false, reason: opts.enrolFails };
      enrolments.push(`${workflow.id}:${lead.id}`);
      return { enrolled: true };
    },
    stripe: opts.stripe ?? { env: {} },
  };
  const store = createWebhookStore(db as unknown as MoneyClient, deps, { now: () => new Date(NOW * 1000) });
  const send = (event: Row, extra: { allowTestEvents?: boolean } = {}) => {
    const rawBody = JSON.stringify(event);
    return handleStripeWebhook({ rawBody, signatureHeader: signPayload(SECRET, rawBody, NOW), secret: SECRET, nowSeconds: NOW, ...extra }, store);
  };
  return { db, send, triggers, enrolments, upserts };
}

const pendingOrder = (over: Row = {}): Row => ({
  id: ORDER, email: null, lead_id: null, status: "pending", total_minor: 4900, currency: "AUD",
  stripe_checkout_session_id: "cs_1", stripe_payment_intent_id: null, stripe_subscription_id: null, metadata: {}, ...over,
});

const checkout = (over: Row = {}, id = "evt_paid_1"): Row => ({
  id, type: "checkout.session.completed", created: NOW, livemode: true,
  data: { object: {
    id: "cs_1", payment_status: "paid", amount_total: 4900, currency: "aud", payment_intent: "pi_1",
    customer_details: { email: "Bea@Example.com", name: "Bea Buyer" }, metadata: { order_id: ORDER }, ...over,
  } },
});

const activities = (db: FakeDb, type?: string) => db.rows("lead_activities").filter((a) => !type || a.activity_type === type);

test("a paid checkout: order paid, a customer lead with only tag_added and status triggers, onboarding, recorded result", async () => {
  const h = home({ orders: [pendingOrder()], order_items: [{ order_id: ORDER, product_id: PRODUCT, quantity: 1, amount_minor: 4900 }] });
  const out = await h.send(checkout());
  assert.equal(out.status, 200);

  const order = h.db.rows("orders")[0];
  assert.equal(order.status, "paid");
  assert.equal(order.stripe_payment_intent_id, "pi_1");
  assert.equal(order.livemode, true);
  const lead = h.db.rows("leads")[0];
  assert.equal(lead.email, "bea@example.com");
  assert.deepEqual(lead.tags, ["customer"]);
  assert.equal(lead.status, "converted");
  assert.equal(order.lead_id, lead.id);
  assert.deepEqual(h.triggers, ["tag_added:customer", "status_changed:converted"]);
  assert.deepEqual(h.enrolments, [`${WORKFLOW}:${lead.id}`]);
  const paid = activities(h.db, "payment_received");
  assert.equal(paid.length, 1);
  assert.equal(paid[0].title, "Paid $49.00 — Strategy session");

  const event = h.db.rows("payment_events")[0];
  assert.ok(event.processed_at);
  assert.equal(event.claimed_at, null);
  assert.equal(event.livemode, true);
  assert.deepEqual((event.result as Row).onboarding, { enrolled: true });
});

test("replaying the same event changes nothing: no second activity, trigger or enrolment", async () => {
  const h = home({ orders: [pendingOrder()] });
  await h.send(checkout());
  const again = await h.send(checkout());
  assert.deepEqual(again.body, { received: true, duplicate: true });
  assert.equal(activities(h.db, "payment_received").length, 1);
  assert.equal(h.triggers.length, 2);
  assert.equal(h.enrolments.length, 1);
});

test("an existing lead is found by email whatever its case, and keeps its tags", async () => {
  const h = home({ orders: [pendingOrder()], leads: [{ id: "lead-1", email: "bea@example.com", tags: ["newsletter"], status: "engaged" }] });
  await h.send(checkout());
  assert.equal(h.upserts.length, 0);
  assert.deepEqual(h.db.rows("leads")[0].tags, ["newsletter", "customer"]);
});

test("client_reference_id is never trusted: a session naming another order gets its own", async () => {
  const h = home({ orders: [pendingOrder({ stripe_checkout_session_id: "cs_other" })] });
  await h.send(checkout({ id: "cs_new", client_reference_id: ORDER, metadata: {} }));
  const [mine, made] = h.db.rows("orders");
  assert.equal(mine.status, "pending"); // untouched
  assert.equal(made.stripe_checkout_session_id, "cs_new");
  assert.equal(made.status, "paid");
});

test("metadata.order_id finds an order only while it has no session or this one", async () => {
  const fresh = home({ orders: [pendingOrder({ stripe_checkout_session_id: null })] });
  await fresh.send(checkout());
  assert.equal(fresh.db.rows("orders").length, 1);
  assert.equal(fresh.db.rows("orders")[0].status, "paid");

  const taken = home({ orders: [pendingOrder({ stripe_checkout_session_id: "cs_someone_else" })] });
  await taken.send(checkout());
  assert.equal(taken.db.rows("orders")[0].status, "pending");
  assert.equal(taken.db.rows("orders").length, 2);
});

test("a database error leaves the event unprocessed and the redelivery finishes it", async () => {
  const h = home({ orders: [pendingOrder()] });
  h.db.failWhen = (table, op) => table === "orders" && op === "update";
  const first = await h.send(checkout());
  assert.equal(first.status, 500);
  const row = h.db.rows("payment_events")[0];
  assert.equal(row.processed_at ?? null, null);
  assert.equal(row.claimed_at, null);
  assert.match(String(row.error), /injected update failure on orders/);
  assert.equal(h.db.rows("orders")[0].status, "pending");

  h.db.failWhen = null;
  const retry = await h.send(checkout());
  assert.equal(retry.status, 200);
  assert.equal(h.db.rows("orders")[0].status, "paid");
  assert.equal(activities(h.db, "payment_received").length, 1);
});

test("a failed read is an error, not 'no order': nothing is created", async () => {
  const h = home({ orders: [pendingOrder()] });
  h.db.failWhen = (table, op) => table === "orders" && op === "select";
  const out = await h.send(checkout());
  assert.equal(out.status, 500);
  assert.equal(h.db.rows("orders").length, 1);
});

test("a crash after the order moved resumes the rest on retry, once", async () => {
  const h = home({ orders: [pendingOrder()] });
  h.db.failWhen = (table, op) => table === "lead_activities" && op === "insert";
  assert.equal((await h.send(checkout())).status, 500);
  assert.equal(h.db.rows("orders")[0].status, "paid"); // the move landed
  h.db.failWhen = null;
  const retry = await h.send(checkout());
  assert.equal(retry.status, 200);
  assert.equal(activities(h.db, "payment_received").length, 1);
  assert.equal(h.enrolments.length, 1);
  assert.deepEqual(h.triggers, ["tag_added:customer", "status_changed:converted"]); // not refired
});

test("concurrent deliveries: a live claim answers 409; a claim older than five minutes is taken over", async () => {
  const h = home({ orders: [pendingOrder()] });
  const event = checkout();
  h.db.rows("payment_events").push({ id: "pe1", provider_event_id: event.id, type: event.type, payload: event, processed_at: null, claimed_at: new Date((NOW - 30) * 1000).toISOString() });
  assert.equal((await h.send(event)).status, 409);
  assert.equal(h.db.rows("orders")[0].status, "pending");

  h.db.rows("payment_events")[0].claimed_at = new Date((NOW - 600) * 1000).toISOString();
  assert.equal((await h.send(event)).status, 200);
  assert.equal(h.db.rows("orders")[0].status, "paid");
});

test("a different event that changed the order between read and write wins; this one does nothing", async () => {
  const h = home({ orders: [pendingOrder()] });
  h.db.beforeCall = (table, op) => {
    if (table === "orders" && op === "update") {
      h.db.rows("orders")[0].status = "void"; // the session expired in another delivery
      h.db.beforeCall = null;
    }
  };
  const out = await h.send(checkout());
  assert.equal(out.status, 200);
  assert.equal(h.db.rows("orders")[0].status, "void");
  assert.equal(h.db.rows("leads").length, 0);
});

test("a renewal records the payment without onboarding again", async () => {
  const h = home({
    orders: [pendingOrder({ status: "paid", stripe_subscription_id: "sub_1", lead_id: "lead-1" })],
    leads: [{ id: "lead-1", email: "bea@example.com", tags: ["customer", "subscriber"], status: "converted" }],
  });
  const out = await h.send({ id: "evt_renew", type: "invoice.paid", livemode: true, data: { object: {
    id: "in_9", billing_reason: "subscription_cycle", amount_paid: 4900, currency: "aud", customer_email: "bea@example.com",
    parent: { subscription_details: { subscription: "sub_1" } },
  } } });
  assert.equal(out.status, 200);
  assert.match(String(activities(h.db, "payment_received")[0].title), /^Subscription payment/);
  assert.equal(h.enrolments.length, 0);
  assert.equal(h.triggers.length, 0);
});

test("the first invoice of a subscription the Home never saw makes an order and onboards", async () => {
  const h = home();
  const out = await h.send({ id: "evt_sub_first", type: "invoice.paid", livemode: true, data: { object: {
    id: "in_1", billing_reason: "subscription_create", amount_paid: 9900, currency: "aud", customer_email: "dash@example.com", subscription: "sub_dash",
  } } });
  assert.equal(out.status, 200);
  const order = h.db.rows("orders")[0];
  assert.equal(order.stripe_subscription_id, "sub_dash");
  assert.equal(order.status, "paid");
  assert.deepEqual(h.db.rows("leads")[0].tags, ["customer", "subscriber"]);
  assert.equal(h.enrolments.length, 1);
});

test("an invoice that beats its Home checkout waits for it (stays unprocessed)", async () => {
  const h = home({ orders: [pendingOrder({ stripe_checkout_session_id: "cs_1" })] });
  const out = await h.send({ id: "evt_early", type: "invoice.paid", livemode: true, data: { object: {
    id: "in_1", billing_reason: "subscription_create", amount_paid: 9900, currency: "aud", customer_email: "bea@example.com",
    parent: { subscription_details: { subscription: "sub_1", metadata: { order_id: ORDER } } },
  } } });
  assert.equal(out.status, 500);
  assert.match(String(h.db.rows("payment_events")[0].error), /before its checkout/);
  assert.equal(h.db.rows("orders").length, 1);
});

test("a trial: no customer tag or onboarding until its first real invoice, which converts it", async () => {
  const h = home({ orders: [pendingOrder({ total_minor: 0 })] });
  await h.send(checkout({ amount_total: 0, payment_status: "no_payment_required", subscription: "sub_t", payment_intent: null }));
  let order = h.db.rows("orders")[0];
  assert.equal(order.status, "trial");
  const lead = h.db.rows("leads")[0];
  assert.deepEqual(lead.tags, ["trial"]);
  assert.equal(lead.status, "new");
  assert.equal(h.enrolments.length, 0);

  await h.send({ id: "evt_trial_paid", type: "invoice.paid", livemode: true, data: { object: {
    id: "in_t", billing_reason: "subscription_cycle", amount_paid: 9900, currency: "aud", customer_email: "bea@example.com", subscription: "sub_t",
  } } });
  order = h.db.rows("orders")[0];
  assert.equal(order.status, "paid");
  assert.deepEqual(h.db.rows("leads")[0].tags, ["customer", "subscriber"]);
  assert.equal(h.db.rows("leads")[0].status, "converted");
  assert.equal(h.enrolments.length, 1);
});

test("refund of a subscription payment is found through its invoice's subscription", async () => {
  const calls: string[] = [];
  const fetch = (async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify({ id: "in_9", status: "paid", subscription: "sub_1" }), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  const h = home(
    {
      orders: [pendingOrder({ status: "paid", stripe_subscription_id: "sub_1", stripe_payment_intent_id: "pi_first", lead_id: "lead-1" })],
      leads: [{ id: "lead-1", email: "bea@example.com", tags: ["customer", "subscriber"], status: "converted" }],
    },
    { stripe: { env: { STRIPE_SECRET_KEY: "sk_test_fabricated" }, fetch } }
  );
  const out = await h.send({ id: "evt_ref", type: "charge.refunded", livemode: true, data: { object: {
    id: "ch_2", payment_intent: "pi_renewal", invoice: "in_9", amount: 4900, amount_refunded: 4900, refunded: true, currency: "aud",
  } } });
  assert.equal(out.status, 200);
  assert.deepEqual(calls, ["https://api.stripe.com/v1/invoices/in_9"]);
  assert.equal(h.db.rows("orders")[0].status, "refunded");
  assert.deepEqual(h.db.rows("leads")[0].tags, ["customer", "subscriber", "refunded"]);
});

test("a refund matching no order never creates a lead", async () => {
  const h = home();
  const out = await h.send({ id: "evt_stray", type: "charge.refunded", livemode: true, data: { object: {
    id: "ch_x", payment_intent: "pi_x", amount: 100, amount_refunded: 100, refunded: true, currency: "aud", billing_details: { email: "stranger@example.com" },
  } } });
  assert.equal(out.status, 200);
  assert.equal(h.db.rows("leads").length, 0);
  assert.equal(h.upserts.length, 0);
});

test("a late partial refund never overwrites a full one", async () => {
  const h = home({ orders: [pendingOrder({ status: "paid", stripe_payment_intent_id: "pi_1" })] });
  const refund = (id: string, refunded: number, full: boolean) => ({ id, type: "charge.refunded", livemode: true, data: { object: {
    id: "ch_1", payment_intent: "pi_1", amount: 4900, amount_refunded: refunded, refunded: full, currency: "aud",
  } } });
  await h.send(refund("evt_full", 4900, true));
  await h.send(refund("evt_partial_late", 1000, false));
  const order = h.db.rows("orders")[0];
  assert.equal(order.status, "refunded");
  assert.equal((order.metadata as Row).refunded_minor, 4900);
});

test("a refund that beats its payment stays unprocessed", async () => {
  const h = home({ orders: [pendingOrder({ stripe_payment_intent_id: "pi_1" })] });
  const out = await h.send({ id: "evt_ref_early", type: "charge.refunded", livemode: true, data: { object: {
    id: "ch_1", payment_intent: "pi_1", amount: 4900, amount_refunded: 4900, refunded: true, currency: "aud",
  } } });
  assert.equal(out.status, 500);
  assert.equal(h.db.rows("orders")[0].status, "pending");
});

test("an async payment that fails voids the pending order", async () => {
  const h = home({ orders: [pendingOrder()] });
  await h.send({ id: "evt_fail", type: "checkout.session.async_payment_failed", livemode: true, data: { object: { id: "cs_1", metadata: { order_id: ORDER } } } });
  const order = h.db.rows("orders")[0];
  assert.equal(order.status, "void");
  assert.equal((order.metadata as Row).void_reason, "payment_failed");
  assert.equal(h.db.rows("leads").length, 0);
});

test("a test-mode event on a live Home changes nothing", async () => {
  const h = home({ orders: [pendingOrder()] });
  const out = await h.send({ ...checkout(), livemode: false });
  assert.equal(out.status, 200);
  assert.equal(h.db.rows("orders")[0].status, "pending");
  assert.equal(h.db.rows("payment_events")[0].livemode, false);
});

test("a failed onboarding enrolment is logged on the timeline and in the event's result", async () => {
  const h = home({ orders: [pendingOrder()] }, { enrolFails: "database is down" });
  await h.send(checkout());
  const failed = activities(h.db, "onboarding_failed");
  assert.equal(failed.length, 1);
  assert.match(String(failed[0].title), /database is down/);
  assert.deepEqual((h.db.rows("payment_events")[0].result as Row).onboarding, { enrolled: false, reason: "database is down" });
});

test("an onboarding setting naming the seeded draft is quiet: no failure entry, a reason in the result", async () => {
  const h = home({ orders: [pendingOrder()], workflows: [{ id: WORKFLOW, name: "Customer onboarding", status: "draft" }] });
  await h.send(checkout());
  const failures = activities(h.db, "onboarding_failed");
  assert.equal(failures.length, 0, String(failures[0]?.title));
  assert.deepEqual((h.db.rows("payment_events")[0].result as Row).onboarding, { enrolled: false, reason: "onboarding workflow is still a draft" });
});

test("an onboarding setting naming an inactive workflow is visible, not silent", async () => {
  const h = home({ orders: [pendingOrder()], workflows: [{ id: WORKFLOW, name: "Customer onboarding", status: "paused" }] });
  await h.send(checkout());
  assert.match(String(activities(h.db, "onboarding_failed")[0]?.title), /not an active workflow/);
});

test("a subscription that ends swaps subscriber for subscription-ended; an ended trial voids", async () => {
  const h = home({
    orders: [
      pendingOrder({ status: "paid", stripe_subscription_id: "sub_1", lead_id: "lead-1" }),
      pendingOrder({ id: "44444444-4444-4444-8444-444444444444", status: "trial", stripe_checkout_session_id: "cs_t", stripe_subscription_id: "sub_t" }),
    ],
    leads: [{ id: "lead-1", email: "bea@example.com", tags: ["customer", "subscriber"], status: "converted" }],
  });
  await h.send({ id: "evt_end", type: "customer.subscription.deleted", livemode: true, data: { object: { id: "sub_1", ended_at: NOW } } });
  assert.deepEqual(h.db.rows("leads")[0].tags, ["customer", "subscription-ended"]);
  assert.equal(h.db.rows("orders")[0].status, "paid");
  await h.send({ id: "evt_end_t", type: "customer.subscription.deleted", livemode: true, data: { object: { id: "sub_t", ended_at: NOW } } });
  assert.equal(h.db.rows("orders")[1].status, "void");
});

test("a subscription refund that beats its Home checkout stays unprocessed", async () => {
  const fetch = (async (url: string) => {
    const body = url.endsWith("/v1/invoices/in_9")
      ? { id: "in_9", status: "paid", parent: { subscription_details: { subscription: "sub_new" } } }
      : url.endsWith("/v1/subscriptions/sub_new") ? { id: "sub_new", status: "active", metadata: { order_id: ORDER } } : {};
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  const h = home({ orders: [pendingOrder()] }, { stripe: { env: { STRIPE_SECRET_KEY: "sk_test_fabricated" }, fetch } });
  const out = await h.send({ id: "evt_sub_ref_early", type: "charge.refunded", livemode: true, data: { object: {
    id: "ch_3", payment_intent: "pi_sub", invoice: "in_9", amount: 9900, amount_refunded: 9900, refunded: true, currency: "aud",
  } } });
  assert.equal(out.status, 500);
  assert.match(String(h.db.rows("payment_events")[0].error), /before its checkout/);
  assert.equal(h.db.rows("payment_events")[0].processed_at ?? null, null);
});

test("two partial refunds racing never lower the recorded amount", async () => {
  const h = home({ orders: [pendingOrder({ status: "paid", stripe_payment_intent_id: "pi_1" })] });
  h.db.beforeCall = (table, op) => {
    if (table === "orders" && op === "update") {
      (h.db.rows("orders")[0].metadata as Row).refunded_minor = 2000; // the other refund event landed first
      h.db.beforeCall = null;
    }
  };
  const partial = { id: "evt_p1", type: "charge.refunded", livemode: true, data: { object: {
    id: "ch_1", payment_intent: "pi_1", amount: 4900, amount_refunded: 1000, refunded: false, currency: "aud",
  } } };
  assert.equal((await h.send(partial)).status, 500); // lost the race: retried, not overwritten
  assert.equal((h.db.rows("orders")[0].metadata as Row).refunded_minor, 2000);
  assert.equal((await h.send(partial)).status, 200);
  assert.equal((h.db.rows("orders")[0].metadata as Row).refunded_minor, 2000);
  assert.equal(h.db.rows("orders")[0].status, "paid");
});
