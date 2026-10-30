import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptsTestEvents,
  cancelInvoice,
  checkoutSessionParams,
  createCheckoutSession,
  encodeForm,
  isMoneyReady,
  isStripeConfigured,
  keyLivemode,
  priceMismatch,
  pushInvoiceToStripe,
  retrieveSubscription,
  sendInvoice,
  voidInvoice,
} from "./stripe-client.ts";

const NO_KEY = { STRIPE_SECRET_KEY: undefined };
// Fabricated: shaped like a test key, never valid at Stripe.
const KEY = { STRIPE_SECRET_KEY: "sk_test_fabricated" };

function recordingFetch(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift() ?? { body: {} };
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const checkoutInput = {
  product: { name: "Strategy session", kind: "one_time" as const, amount_minor: 4900, currency: "AUD" },
  orderId: "11111111-1111-4111-8111-111111111111",
  productSlug: "strategy-session",
  successUrl: "https://example.com/thanks",
  cancelUrl: "https://example.com/offer",
};

test("every call answers 503 'Stripe is not configured' without a key, and never reaches the network", async () => {
  const { fn, calls } = recordingFetch([]);
  const opts = { env: NO_KEY, fetch: fn };
  const results = await Promise.all([
    createCheckoutSession(checkoutInput, opts),
    pushInvoiceToStripe(
      { homeInvoiceId: "i", email: "c@example.com", currency: "AUD", daysUntilDue: 14, items: [{ description: "Work", quantity: 1, amount_minor: 100 }] },
      { onDraftCreated: async () => {} },
      opts
    ),
    sendInvoice("in_1", opts),
    voidInvoice("in_1", opts),
    retrieveSubscription("sub_1", opts),
  ]);
  for (const r of results) assert.deepEqual(r, { ok: false, status: 503, error: "Stripe is not configured" });
  assert.equal(calls.length, 0);
  assert.equal(isStripeConfigured(NO_KEY), false);
  assert.equal(isStripeConfigured({ STRIPE_SECRET_KEY: "  " }), false);
  assert.equal(isStripeConfigured(KEY), true);
});

test("Stripe's form encoding brackets nested keys and drops nulls", () => {
  assert.equal(
    encodeForm({ mode: "payment", line_items: [{ quantity: 1, price_data: { currency: "aud", unit_amount: 4900 } }], skip: null, gone: undefined }),
    "mode=payment&line_items%5B0%5D%5Bquantity%5D=1&line_items%5B0%5D%5Bprice_data%5D%5Bcurrency%5D=aud&line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=4900"
  );
  assert.equal(encodeForm({ a: true, b: "x y&z" }), "a=true&b=x%20y%26z");
});

test("checkout prices inline, or by stripe_price_id, and subscriptions recur", () => {
  const inline = checkoutSessionParams(checkoutInput);
  assert.equal(inline.mode, "payment");
  assert.deepEqual((inline.line_items as unknown[])[0], {
    quantity: 1,
    price_data: { currency: "aud", unit_amount: 4900, product_data: { name: "Strategy session", description: undefined }, recurring: undefined },
  });
  assert.equal(inline.client_reference_id, checkoutInput.orderId);
  assert.deepEqual(inline.payment_intent_data, { metadata: { order_id: checkoutInput.orderId, product_slug: "strategy-session" } });

  const byPrice = checkoutSessionParams({ ...checkoutInput, product: { ...checkoutInput.product, stripe_price_id: "price_123" } });
  assert.deepEqual((byPrice.line_items as unknown[])[0], { quantity: 1, price: "price_123" });

  const sub = checkoutSessionParams({ ...checkoutInput, product: { ...checkoutInput.product, kind: "subscription", interval: "month" } });
  assert.equal(sub.mode, "subscription");
  assert.equal(sub.payment_intent_data, undefined);
  assert.deepEqual(sub.subscription_data, { metadata: { order_id: checkoutInput.orderId, product_slug: "strategy-session" } });
});

test("with a key, checkout posts form data with the bearer key and an idempotency key", async () => {
  const { fn, calls } = recordingFetch([{ body: { id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" } }]);
  const result = await createCheckoutSession(checkoutInput, { env: KEY, fetch: fn });
  assert.deepEqual(result, { ok: true, data: { id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" } });
  assert.equal(calls[0].url, "https://api.stripe.com/v1/checkout/sessions");
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer sk_test_fabricated");
  assert.equal(headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.equal(headers["Idempotency-Key"], `checkout-${checkoutInput.orderId}`);
  assert.match(String(calls[0].init.body), /success_url=https%3A%2F%2Fexample\.com%2Fthanks/);
});

test("Stripe's own errors come back with its message and status", async () => {
  const { fn } = recordingFetch([{ status: 400, body: { error: { message: "No such price: 'price_x'" } } }]);
  const result = await createCheckoutSession(checkoutInput, { env: KEY, fetch: fn });
  assert.deepEqual(result, { ok: false, status: 400, error: "Stripe: No such price: 'price_x'" });
  const down = recordingFetch([{ status: 500, body: {} }]);
  const r2 = await retrieveSubscription("sub_1", { env: KEY, fetch: down.fn });
  assert.equal(r2.ok === false && r2.status, 502);
});

test("an invoice is customer → invoice (recorded) → items → finalize, with nothing sent", async () => {
  const { fn, calls } = recordingFetch([
    { body: { data: [] } },
    { body: { id: "cus_1" } },
    { body: { id: "in_1", status: "draft" } },
    { body: { id: "ii_1" } },
    { body: { id: "ii_2" } },
    { body: { id: "in_1", status: "open", number: "ABC-0001", hosted_invoice_url: "https://invoice.stripe.com/i/1", invoice_pdf: null } },
  ]);
  const recorded: Array<{ id: string; callsSoFar: number }> = [];
  const result = await pushInvoiceToStripe(
    {
      homeInvoiceId: "inv-home-1",
      email: "client@example.com",
      currency: "AUD",
      daysUntilDue: 14,
      items: [
        { description: "Brand strategy", quantity: 1, amount_minor: 300000 },
        { description: "Workshop", quantity: 2, amount_minor: 50000 },
      ],
    },
    { onDraftCreated: async (id) => void recorded.push({ id, callsSoFar: calls.length }) },
    { env: KEY, fetch: fn }
  );
  assert.equal(result.ok && result.data.number, "ABC-0001");
  assert.deepEqual(
    calls.map((c) => `${c.init.method} ${c.url.replace("https://api.stripe.com", "").split("?")[0]}`),
    ["GET /v1/customers", "POST /v1/customers", "POST /v1/invoices", "POST /v1/invoiceitems", "POST /v1/invoiceitems", "POST /v1/invoices/in_1/finalize"]
  );
  assert.deepEqual(recorded, [{ id: "in_1", callsSoFar: 3 }]); // recorded before any item
  assert.match(String(calls[2].init.body), /auto_advance=false/);
  assert.match(String(calls[2].init.body), /collection_method=send_invoice/);
  assert.equal((calls[2].init.headers as Record<string, string>)["Idempotency-Key"], "invoice-inv-home-1-first-create");
  assert.match(String(calls[4].init.body), /amount=100000/); // 2 × 50000
  assert.ok(!calls.some((c) => c.url.endsWith("/send")));
});

const oneItem = { homeInvoiceId: "h1", email: "c@example.com", currency: "AUD", daysUntilDue: 14, items: [{ description: "Work", quantity: 1, amount_minor: 5000 }] };

test("resuming: a Stripe draft whose total already matches is only finalized", async () => {
  const { fn, calls } = recordingFetch([
    { body: { id: "in_1", status: "draft", total: 5000 } },
    { body: { id: "in_1", status: "open", number: "N-1", hosted_invoice_url: null, invoice_pdf: null } },
  ]);
  const result = await pushInvoiceToStripe(oneItem, { existingStripeId: "in_1", onDraftCreated: async () => assert.fail("no new draft") }, { env: KEY, fetch: fn });
  assert.equal(result.ok, true);
  assert.deepEqual(calls.map((c) => `${c.init.method} ${c.url.split("?")[0].replace("https://api.stripe.com", "")}`), ["GET /v1/invoices/in_1", "POST /v1/invoices/in_1/finalize"]);
});

test("resuming: a half-built draft is deleted and rebuilt under a new idempotency key", async () => {
  const { fn, calls } = recordingFetch([
    { body: { id: "in_1", status: "draft", total: 0 } },
    { body: { id: "in_1", deleted: true } },
    { body: { data: [{ id: "cus_1" }] } },
    { body: { id: "in_2", status: "draft" } },
    { body: { id: "ii_1" } },
    { body: { id: "in_2", status: "open", number: "N-2", hosted_invoice_url: null, invoice_pdf: null } },
  ]);
  const recorded: string[] = [];
  const result = await pushInvoiceToStripe(oneItem, { existingStripeId: "in_1", onDraftCreated: async (id) => void recorded.push(id) }, { env: KEY, fetch: fn });
  assert.equal(result.ok && result.data.id, "in_2");
  assert.equal(calls[1].init.method, "DELETE");
  assert.equal((calls[3].init.headers as Record<string, string>)["Idempotency-Key"], "invoice-h1-in_1-create");
  assert.deepEqual(recorded, ["in_2"]);
});

test("resuming: an already finalized invoice is returned untouched", async () => {
  const { fn, calls } = recordingFetch([{ body: { id: "in_1", status: "open", number: "N-1", hosted_invoice_url: "h", invoice_pdf: "p" } }]);
  const result = await pushInvoiceToStripe(oneItem, { existingStripeId: "in_1", onDraftCreated: async () => {} }, { env: KEY, fetch: fn });
  assert.equal(result.ok && result.data.status, "open");
  assert.equal(calls.length, 1);
});

test("money is ready only with both secrets; test events follow the key unless allowed", () => {
  assert.equal(isMoneyReady({ STRIPE_SECRET_KEY: "sk_test_x" }), false);
  assert.equal(isMoneyReady({ STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_x" }), true);
  assert.equal(acceptsTestEvents({ STRIPE_SECRET_KEY: "sk_test_x" }), true);
  assert.equal(acceptsTestEvents({ STRIPE_SECRET_KEY: "rk_test_x" }), true);
  assert.equal(acceptsTestEvents({ STRIPE_SECRET_KEY: "sk_live_x" }), false);
  assert.equal(acceptsTestEvents({ STRIPE_SECRET_KEY: "sk_live_x", STRIPE_ALLOW_TEST_EVENTS: "true" }), true);
  assert.equal(keyLivemode({ STRIPE_SECRET_KEY: "sk_live_x" }), true);
  assert.equal(keyLivemode({ STRIPE_SECRET_KEY: "sk_test_x" }), false);
  assert.equal(keyLivemode({}), null);
});

test("a stripe_price_id must charge exactly what the product says", () => {
  const product = { amount_minor: 4900, currency: "AUD", kind: "one_time", interval: null };
  const price = { id: "price_1", active: true, currency: "aud", unit_amount: 4900, recurring: null };
  assert.equal(priceMismatch(price, product), null);
  assert.match(priceMismatch({ ...price, unit_amount: 5900 }, product)!, /charges 5900/);
  assert.match(priceMismatch({ ...price, currency: "usd" }, product)!, /USD/);
  assert.match(priceMismatch({ ...price, active: false }, product)!, /archived/);
  assert.match(priceMismatch({ ...price, recurring: { interval: "month" } }, product)!, /recurs/);
  assert.equal(priceMismatch({ ...price, recurring: { interval: "month" } }, { ...product, kind: "subscription", interval: "month" }), null);
});

test("cancelling an invoice deletes a Stripe draft, voids an open one, refuses a paid one", async () => {
  const run = async (status: string | null) => {
    const { fn, calls } = recordingFetch(status === null ? [{ status: 404, body: { error: { message: "No such invoice" } } }] : [{ body: { id: "in_1", status } }, { body: { id: "in_1" } }]);
    const result = await cancelInvoice("in_1", { env: KEY, fetch: fn });
    return { result, calls: calls.map((c) => `${c.init.method} ${c.url.replace("https://api.stripe.com", "")}`) };
  };
  const draft = await run("draft");
  assert.deepEqual(draft.result, { ok: true, data: { action: "deleted" } });
  assert.deepEqual(draft.calls, ["GET /v1/invoices/in_1", "DELETE /v1/invoices/in_1"]);
  const open = await run("open");
  assert.deepEqual(open.result, { ok: true, data: { action: "voided" } });
  assert.deepEqual(open.calls, ["GET /v1/invoices/in_1", "POST /v1/invoices/in_1/void"]);
  assert.deepEqual((await run("void")).result, { ok: true, data: { action: "already_void" } });
  assert.equal((await run("paid")).result.ok, false);
  assert.deepEqual((await run(null)).result, { ok: true, data: { action: "gone" } });
});
