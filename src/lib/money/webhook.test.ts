import assert from "node:assert/strict";
import test from "node:test";
import { signPayload } from "./stripe-signature.ts";
import { orderTarget, transitionOrder } from "./state.ts";
import { handleStripeWebhook, type WebhookStore } from "./webhook.ts";
import type { OrderStatus } from "../../types/database.ts";

// Fabricated: not a real endpoint secret.
const SECRET = "whsec_fabricated_for_tests";
const NOW = 1_761_500_000;

/**
 * payment_events and orders in memory, with the same unique-id rule as the
 * migration and the same transitions as apply.ts.
 */
function memoryStore(opts: { failTimes?: number; failRecord?: boolean } = {}) {
  const events = new Map<string, { processed: boolean; claimed: boolean; error: string | null }>();
  const orders = new Map<string, OrderStatus>([["cs_test_1", "pending"]]);
  const customers: string[] = [];
  let applied = 0;
  let failures = opts.failTimes ?? 0;

  const store: WebhookStore = {
    async recordEvent(event) {
      if (opts.failRecord) throw new Error("payment_events insert failed: connection reset");
      const seen = events.get(event.id);
      if (!seen) {
        events.set(event.id, { processed: false, claimed: false, error: null });
        return "recorded";
      }
      return seen.processed ? "duplicate" : "recorded";
    },
    async claimEvent(id) {
      const row = events.get(id)!;
      if (row.processed || row.claimed) return false;
      row.claimed = true;
      return true;
    },
    async finishEvent(id) {
      events.set(id, { processed: true, claimed: false, error: null });
    },
    async releaseEvent(id, error) {
      events.set(id, { processed: false, claimed: false, error });
    },
    async applyPlan(plan) {
      applied++;
      if (failures > 0) {
        failures--;
        throw new Error("database hiccup");
      }
      if (plan.kind !== "checkout_paid") return { summary: plan.kind };
      const move = transitionOrder(orders.get(plan.sessionId)!, orderTarget(plan)!);
      if (!move.ok || !move.changed) return { summary: "unchanged" };
      orders.set(plan.sessionId, move.status);
      customers.push(plan.email!);
      return { summary: "paid" };
    },
  };
  return { store, events, orders, customers, applied: () => applied };
}

function delivery(event: object, at = NOW) {
  const rawBody = JSON.stringify(event);
  return { rawBody, signatureHeader: signPayload(SECRET, rawBody, at), secret: SECRET, nowSeconds: NOW };
}

const completed = {
  id: "evt_checkout_1",
  type: "checkout.session.completed",
  created: NOW,
  data: {
    object: {
      id: "cs_test_1",
      payment_status: "paid",
      customer_details: { email: "buyer@example.com" },
      amount_total: 4900,
      currency: "aud",
    },
  },
};

test("a signed event is recorded, applied and marked processed", async () => {
  const mem = memoryStore();
  const out = await handleStripeWebhook(delivery(completed), mem.store);
  assert.equal(out.status, 200);
  assert.equal(mem.orders.get("cs_test_1"), "paid");
  assert.deepEqual(mem.customers, ["buyer@example.com"]);
  assert.deepEqual(mem.events.get("evt_checkout_1"), { processed: true, claimed: false, error: null });
});

test("replaying the same event id is acknowledged and applied once", async () => {
  const mem = memoryStore();
  await handleStripeWebhook(delivery(completed), mem.store);
  const again = await handleStripeWebhook(delivery(completed, NOW + 60), mem.store);
  const third = await handleStripeWebhook(delivery(completed, NOW + 120), mem.store);
  assert.equal(again.status, 200);
  assert.deepEqual(again.body, { received: true, duplicate: true });
  assert.deepEqual(third.body, { received: true, duplicate: true });
  assert.equal(mem.applied(), 1);
  assert.deepEqual(mem.customers, ["buyer@example.com"]);
});

test("a second event for the same session is a no-op transition, not a second sale", async () => {
  const mem = memoryStore();
  await handleStripeWebhook(delivery(completed), mem.store);
  const async = { ...completed, id: "evt_async_1", type: "checkout.session.async_payment_succeeded" };
  const out = await handleStripeWebhook(delivery(async), mem.store);
  assert.equal(out.status, 200);
  assert.equal(mem.applied(), 2);
  assert.deepEqual(mem.customers, ["buyer@example.com"]);
});

test("a failed apply answers 500, keeps the event unprocessed, and the redelivery retries it", async () => {
  const mem = memoryStore({ failTimes: 1 });
  const first = await handleStripeWebhook(delivery(completed), mem.store);
  assert.equal(first.status, 500);
  assert.deepEqual(mem.events.get("evt_checkout_1"), { processed: false, claimed: false, error: "database hiccup" });
  assert.equal(mem.orders.get("cs_test_1"), "pending");

  const retry = await handleStripeWebhook(delivery(completed, NOW + 60), mem.store);
  assert.equal(retry.status, 200);
  assert.equal(mem.orders.get("cs_test_1"), "paid");
  assert.equal(mem.events.get("evt_checkout_1")!.processed, true);
});

test("bad, stale and missing signatures are refused before anything is recorded", async () => {
  const mem = memoryStore();
  const body = JSON.stringify(completed);
  const bad = await handleStripeWebhook({ rawBody: body, signatureHeader: signPayload("whsec_wrong", body, NOW), secret: SECRET, nowSeconds: NOW }, mem.store);
  const stale = await handleStripeWebhook(delivery(completed, NOW - 3600), mem.store);
  const missing = await handleStripeWebhook({ rawBody: body, signatureHeader: null, secret: SECRET }, mem.store);
  assert.equal(bad.status, 400);
  assert.equal(stale.status, 400);
  assert.equal(stale.status === 400 && stale.body.reason, "stale");
  assert.equal(missing.status, 400);
  assert.equal(mem.events.size, 0);
});

test("without STRIPE_WEBHOOK_SECRET the endpoint answers 503", async () => {
  const mem = memoryStore();
  const out = await handleStripeWebhook({ ...delivery(completed), secret: undefined }, mem.store);
  assert.deepEqual(out, { status: 503, body: { error: "Stripe is not configured" } });
  assert.equal(mem.events.size, 0);
});

test("an unhandled event type is recorded, acknowledged and never applied", async () => {
  const mem = memoryStore();
  const out = await handleStripeWebhook(delivery({ id: "evt_other", type: "customer.created", data: { object: { id: "cus_1" } } }), mem.store);
  assert.equal(out.status, 200);
  assert.match(out.status === 200 ? out.body.ignored || "" : "", /not handled/);
  assert.equal(mem.applied(), 0);
  assert.equal(mem.events.get("evt_other")!.processed, true);
});

test("a signed body that is not a Stripe event is a 400", async () => {
  const mem = memoryStore();
  const out = await handleStripeWebhook(delivery({ hello: "world" }), mem.store);
  assert.equal(out.status, 400);
});

test("a delivery that finds the event claimed by another answers 409, so Stripe keeps it", async () => {
  const mem = memoryStore();
  mem.events.set("evt_checkout_1", { processed: false, claimed: true, error: null });
  const out = await handleStripeWebhook(delivery(completed), mem.store);
  assert.equal(out.status, 409);
  assert.equal(mem.applied(), 0);
});

test("a failure to record the event is a 500, never an unhandled throw", async () => {
  const mem = memoryStore({ failRecord: true });
  const out = await handleStripeWebhook(delivery(completed), mem.store);
  assert.equal(out.status, 500);
  assert.match(out.status === 500 ? out.body.error : "", /connection reset/);
});

test("test-mode events are recorded but not applied unless the Home accepts them", async () => {
  const mem = memoryStore();
  const testEvent = { ...completed, id: "evt_test_1", livemode: false };
  const live = await handleStripeWebhook(delivery(testEvent), mem.store);
  assert.equal(live.status, 200);
  assert.match(live.status === 200 ? live.body.ignored || "" : "", /test-mode/);
  assert.equal(mem.applied(), 0);
  assert.equal(mem.events.get("evt_test_1")!.processed, true);

  const mem2 = memoryStore();
  const accepted = await handleStripeWebhook({ ...delivery(testEvent), allowTestEvents: true }, mem2.store);
  assert.equal(accepted.status, 200);
  assert.equal(mem2.applied(), 1);
});
