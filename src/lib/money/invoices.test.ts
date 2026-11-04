import assert from "node:assert/strict";
import test from "node:test";
import type { MoneyClient } from "./db.ts";
import { fakeDb } from "./fake-db.ts";
import { pushAndSendInvoice, type Invoice } from "./invoices.ts";

const INV = "55555555-5555-4555-8555-555555555555";
// Fabricated: shaped like a test key, never valid at Stripe.
const ENV = { STRIPE_SECRET_KEY: "sk_test_fabricated", STRIPE_WEBHOOK_SECRET: "whsec_fabricated" };

function stripeFake(answers: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    const path = url.replace("https://api.stripe.com", "").split("?")[0];
    calls.push(`${init.method} ${path}`);
    const fixed = answers[`${init.method} ${path}`];
    const body =
      fixed ??
      (path === "/v1/customers" && init.method === "GET" ? { data: [{ id: "cus_1" }] }
        : path === "/v1/invoices" ? { id: "in_1", status: "draft" }
        : path.endsWith("/finalize") ? { id: "in_1", status: "open", number: "N-1", hosted_invoice_url: "https://invoice.stripe.com/i/1", invoice_pdf: "https://pay.stripe.com/1.pdf" }
        : path.endsWith("/send") ? { id: "in_1", status: "open", hosted_invoice_url: "https://invoice.stripe.com/i/1", invoice_pdf: "https://pay.stripe.com/1.pdf" }
        : { id: "ii_1" });
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  return { calls, opts: { env: ENV, fetch } };
}

function setup(safeMode: boolean, invoice: Partial<Invoice> = {}, items = [{ description: "Strategy", quantity: 1, amount_minor: 300000 }]) {
  const row = { id: INV, number: "INV-20261027-0001", lead_id: "lead-1", engagement_id: null, status: "draft", due_at: null, total_minor: 300000, currency: "AUD", stripe_invoice_id: null, hosted_url: null, pdf_url: null, paid_at: null, metadata: {}, ...invoice };
  const db = fakeDb({
    invoices: [row],
    invoice_items: items.map((i) => ({ ...i, invoice_id: INV })),
    leads: [{ id: "lead-1", email: "client@example.com", first_name: "Cleo", last_name: null, tags: [], status: "new" }],
    backend_settings: [{ key: "crm_safe_mode", value: safeMode }],
  });
  return { db, row: row as unknown as Invoice, client: db as unknown as MoneyClient };
}

test("safe mode finalizes the invoice in Stripe but never emails it", async () => {
  const { db, row, client } = setup(true);
  const stripe = stripeFake();
  const out = await pushAndSendInvoice(client, row, "human", stripe.opts);
  assert.equal(out.ok && out.sent, false);
  assert.equal(out.ok && out.safe_mode, true);
  assert.ok(stripe.calls.includes("POST /v1/invoices/in_1/finalize"));
  assert.ok(!stripe.calls.some((c) => c.endsWith("/send")));
  const saved = db.rows("invoices")[0];
  assert.equal(saved.status, "draft");
  assert.equal(saved.stripe_invoice_id, "in_1");
  assert.equal((saved.metadata as Record<string, unknown>).stripe_finalized, true);
});

test("outside safe mode it is sent once, logged, and a second send does not finalize again", async () => {
  const { db, row, client } = setup(false);
  const stripe = stripeFake();
  const out = await pushAndSendInvoice(client, row, "human", stripe.opts);
  assert.equal(out.ok && out.sent, true);
  assert.equal(db.rows("invoices")[0].status, "sent");
  assert.equal(db.rows("lead_activities").filter((a) => a.activity_type === "invoice_sent").length, 1);

  const again = await pushAndSendInvoice(client, db.rows("invoices")[0] as unknown as Invoice, "human", stripe.opts);
  assert.equal(again.ok && again.sent, false); // already sent: nothing goes out twice
  assert.equal(stripe.calls.filter((c) => c.endsWith("/send")).length, 1);
  assert.equal(stripe.calls.filter((c) => c.endsWith("/finalize")).length, 1);
});

test("an invoice with no items, or items that do not add up, is refused before Stripe", async () => {
  const empty = setup(false, {}, []);
  const s1 = stripeFake();
  const a = await pushAndSendInvoice(empty.client, empty.row, "human", s1.opts);
  assert.equal(!a.ok && a.failure.status, 409);
  assert.equal(s1.calls.length, 0);

  const off = setup(false, { total_minor: 999 });
  const s2 = stripeFake();
  const b = await pushAndSendInvoice(off.client, off.row, "human", s2.opts);
  assert.equal(!b.ok && b.failure.status, 409);
  assert.match(!b.ok ? b.failure.error : "", /add up/);
  assert.equal(s2.calls.length, 0);
});

test("the Stripe id is saved as soon as the draft exists, so a failed item resumes instead of duplicating", async () => {
  const { db, row, client } = setup(false);
  const failing = (async (url: string, init: RequestInit) => {
    const path = url.replace("https://api.stripe.com", "").split("?")[0];
    if (path === "/v1/invoiceitems") return new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429 });
    const body = path === "/v1/customers" ? { data: [{ id: "cus_1" }] } : { id: "in_1", status: "draft" };
    void init;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  const out = await pushAndSendInvoice(client, row, "human", { env: ENV, fetch: failing });
  assert.equal(out.ok, false);
  assert.equal(db.rows("invoices")[0].stripe_invoice_id, "in_1");

  // The retry sees the half-built draft (total 0), deletes it and rebuilds.
  const stripe = stripeFake({
    "GET /v1/invoices/in_1": { id: "in_1", status: "draft", total: 0 },
    "POST /v1/invoices": { id: "in_2", status: "draft" },
    "POST /v1/invoices/in_2/finalize": { id: "in_2", status: "open", number: "N-2", hosted_invoice_url: "https://invoice.stripe.com/i/2", invoice_pdf: null },
    "POST /v1/invoices/in_2/send": { id: "in_2", status: "open", hosted_invoice_url: "https://invoice.stripe.com/i/2", invoice_pdf: null },
  });
  const retry = await pushAndSendInvoice(client, db.rows("invoices")[0] as unknown as Invoice, "human", stripe.opts);
  assert.equal(retry.ok, true);
  assert.deepEqual(stripe.calls.slice(0, 2), ["GET /v1/invoices/in_1", "DELETE /v1/invoices/in_1"]);
  assert.equal(db.rows("invoices")[0].stripe_invoice_id, "in_2");
  assert.equal(stripe.calls.filter((c) => c === "POST /v1/invoices").length, 1);
});
