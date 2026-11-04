/**
 * A thin Stripe client: `fetch` against https://api.stripe.com, no SDK, so it
 * runs unchanged on Workers. Only the calls the Home needs: Checkout
 * Sessions, Invoices (customer, items, finalize, send, void) and
 * Subscriptions.
 *
 * Reads STRIPE_SECRET_KEY. Without it every call answers
 * { ok: false, status: 503, error: "Stripe is not configured" } and makes no
 * request, so a Home that has not connected Stripe fails cleanly.
 *
 * No framework imports, so `node --test` can load it; tests pass their own
 * env and fetch.
 */

import { stripeCurrency } from "./money.ts";

export const STRIPE_API = "https://api.stripe.com";
export const NOT_CONFIGURED = "Stripe is not configured";

export type StripeResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

export interface StripeOptions {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  /** Stripe replays the first answer for a repeated key instead of creating twice. */
  idempotencyKey?: string;
}

type Params = Record<string, unknown>;

export function stripeSecretKey(env: Record<string, string | undefined> = process.env): string | null {
  const key = env.STRIPE_SECRET_KEY?.trim();
  return key ? key : null;
}

export function isStripeConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return stripeSecretKey(env) !== null;
}

/**
 * Money is live only with BOTH secrets: without the webhook secret a buyer
 * could pay and the Home would never hear of it. Checkout and invoice sending
 * check this; the low-level calls below only need the secret key.
 */
export function isMoneyReady(env: Record<string, string | undefined> = process.env): boolean {
  return stripeSecretKey(env) !== null && !!env.STRIPE_WEBHOOK_SECRET?.trim();
}

/**
 * Test-mode events reach the CRM only on a Home running test keys, or with
 * STRIPE_ALLOW_TEST_EVENTS=true. A live Home ignores them, so a test purchase
 * never makes a real customer or sends real onboarding.
 */
export function acceptsTestEvents(env: Record<string, string | undefined> = process.env): boolean {
  if ((env.STRIPE_ALLOW_TEST_EVENTS || "").trim().toLowerCase() === "true") return true;
  return /^(sk|rk)_test_/.test(stripeSecretKey(env) || "");
}

/** The mode the configured key runs in: true live, false test, null unknown. */
export function keyLivemode(env: Record<string, string | undefined> = process.env): boolean | null {
  const key = stripeSecretKey(env) || "";
  if (/^(sk|rk)_live_/.test(key)) return true;
  if (/^(sk|rk)_test_/.test(key)) return false;
  return null;
}

/**
 * Stripe's form encoding: nested objects and arrays become bracketed keys.
 * { line_items: [{ price: "p", quantity: 1 }] } → line_items[0][price]=p&line_items[0][quantity]=1.
 * Null and undefined are left out.
 */
export function encodeForm(params: Params): string {
  const pairs: string[] = [];
  const walk = (prefix: string, value: unknown) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(`${prefix}[${i}]`, v));
    } else if (typeof value === "object") {
      for (const [k, v] of Object.entries(value as Params)) walk(prefix ? `${prefix}[${k}]` : k, v);
    } else {
      pairs.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(value))}`);
    }
  };
  walk("", params);
  return pairs.join("&");
}

async function call<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  params: Params | null,
  opts: StripeOptions = {}
): Promise<StripeResult<T>> {
  const key = stripeSecretKey(opts.env ?? process.env);
  if (!key) return { ok: false, status: 503, error: NOT_CONFIGURED };

  const doFetch = opts.fetch ?? fetch;
  const query = method === "GET" && params ? `?${encodeForm(params)}` : "";
  const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
  if (method !== "GET") headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (method === "POST" && opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  let res: Response;
  try {
    res = await doFetch(`${STRIPE_API}${path}${query}`, {
      method,
      headers,
      body: method === "GET" ? undefined : encodeForm(params || {}),
    });
  } catch (e) {
    return { ok: false, status: 502, error: `Could not reach Stripe: ${e instanceof Error ? e.message : String(e)}` };
  }

  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & T;
  if (!res.ok) {
    // Stripe's message is safe to show the owner ("No such price: …"); its
    // 4xx stays a 4xx, anything else is a bad gateway.
    const status = res.status >= 400 && res.status < 500 ? res.status : 502;
    return { ok: false, status, error: `Stripe: ${body.error?.message || `request failed (${res.status})`}` };
  }
  return { ok: true, data: body };
}

// ── Checkout ─────────────────────────────────────────────────────────────────

export interface CheckoutProduct {
  name: string;
  description?: string | null;
  kind: "one_time" | "subscription" | "deposit";
  amount_minor: number;
  currency: string;
  interval?: "month" | "year" | null;
  stripe_price_id?: string | null;
}

export interface CheckoutSession {
  id: string;
  url: string | null;
}

/** The params for POST /v1/checkout/sessions. Exported so tests can read them without a network. */
export function checkoutSessionParams(input: {
  product: CheckoutProduct;
  orderId: string;
  productSlug: string;
  successUrl: string;
  cancelUrl: string;
  email?: string | null;
}): Params {
  const { product } = input;
  const subscription = product.kind === "subscription";
  const lineItem: Params = { quantity: 1 };
  if (product.stripe_price_id) {
    lineItem.price = product.stripe_price_id;
  } else {
    lineItem.price_data = {
      currency: stripeCurrency(product.currency),
      unit_amount: product.amount_minor,
      product_data: { name: product.name, description: product.description || undefined },
      recurring: subscription ? { interval: product.interval } : undefined,
    };
  }
  const metadata = { order_id: input.orderId, product_slug: input.productSlug };
  return {
    mode: subscription ? "subscription" : "payment",
    line_items: [lineItem],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    customer_email: input.email || undefined,
    client_reference_id: input.orderId,
    metadata,
    // Carried onto the payment or subscription so refunds and cancellations
    // find their way back to the order.
    payment_intent_data: subscription ? undefined : { metadata },
    subscription_data: subscription ? { metadata } : undefined,
  };
}

export function createCheckoutSession(
  input: Parameters<typeof checkoutSessionParams>[0],
  opts: StripeOptions = {}
): Promise<StripeResult<CheckoutSession>> {
  return call<CheckoutSession>("POST", "/v1/checkout/sessions", checkoutSessionParams(input), {
    idempotencyKey: `checkout-${input.orderId}`,
    ...opts,
  });
}

// ── Invoicing ────────────────────────────────────────────────────────────────

export interface StripeInvoice {
  id: string;
  number: string | null;
  status: string;
  total?: number;
  hosted_invoice_url: string | null;
  invoice_pdf: string | null;
  subscription?: string | { id: string } | null;
  parent?: { subscription_details?: { subscription?: string | { id: string } | null } | null } | null;
}

export interface InvoiceDraft {
  homeInvoiceId: string;
  email: string;
  name?: string | null;
  currency: string;
  daysUntilDue: number;
  description?: string | null;
  items: Array<{ description: string; quantity: number; amount_minor: number }>;
}

async function findOrCreateCustomer(
  email: string,
  name: string | null | undefined,
  opts: StripeOptions
): Promise<StripeResult<{ id: string }>> {
  const found = await call<{ data: Array<{ id: string }> }>("GET", "/v1/customers", { email, limit: 1 }, opts);
  if (!found.ok) return found;
  if (found.data.data?.[0]?.id) return { ok: true, data: { id: found.data.data[0].id } };
  return call<{ id: string }>("POST", "/v1/customers", { email, name: name || undefined }, opts);
}

export function retrieveInvoice(id: string, opts: StripeOptions = {}): Promise<StripeResult<StripeInvoice>> {
  return call<StripeInvoice>("GET", `/v1/invoices/${encodeURIComponent(id)}`, null, opts);
}

/** The subscription an invoice belongs to, in either API shape. */
export function invoiceSubscriptionId(invoice: StripeInvoice): string | null {
  const ref = (v: unknown) => (typeof v === "string" ? v : v && typeof v === "object" ? String((v as { id?: unknown }).id ?? "") || null : null);
  return ref(invoice.subscription) ?? ref(invoice.parent?.subscription_details?.subscription);
}

/**
 * Puts a Home invoice into Stripe and finalizes it (a number, a hosted page,
 * a PDF). auto_advance is off, so nothing is emailed or charged; sendInvoice
 * is the outward step.
 *
 * Resumable: `existingStripeId` is the Stripe invoice an earlier attempt
 * recorded. A finalized one is returned as it is; a draft whose total already
 * matches is finalized; any other draft is deleted and rebuilt. onDraftCreated
 * records the new id before any item is added, so a crash between steps
 * resumes here instead of leaving a second invoice in Stripe. Idempotency keys
 * name the Home invoice and the draft being replaced, so a retry inside
 * Stripe's 24 hours replays rather than creates.
 */
export async function pushInvoiceToStripe(
  draft: InvoiceDraft,
  resume: { existingStripeId?: string | null; onDraftCreated: (stripeInvoiceId: string) => Promise<void> },
  opts: StripeOptions = {}
): Promise<StripeResult<StripeInvoice>> {
  if (!isStripeConfigured(opts.env ?? process.env)) return { ok: false, status: 503, error: NOT_CONFIGURED };
  const expectedTotal = draft.items.reduce((sum, i) => sum + i.amount_minor * i.quantity, 0);

  if (resume.existingStripeId) {
    const current = await retrieveInvoice(resume.existingStripeId, opts);
    if (!current.ok && current.status !== 404) return current;
    if (current.ok) {
      if (current.data.status !== "draft") return current;
      if (current.data.total === expectedTotal) {
        return call<StripeInvoice>("POST", `/v1/invoices/${encodeURIComponent(current.data.id)}/finalize`, { auto_advance: false }, {
          ...opts,
          idempotencyKey: `invoice-${draft.homeInvoiceId}-${current.data.id}-finalize`,
        });
      }
      const removed = await call("DELETE", `/v1/invoices/${encodeURIComponent(current.data.id)}`, null, opts);
      if (!removed.ok && removed.status !== 404) return removed;
    }
  }

  const key = `invoice-${draft.homeInvoiceId}-${resume.existingStripeId || "first"}`;
  const customer = await findOrCreateCustomer(draft.email, draft.name, { ...opts, idempotencyKey: `${key}-customer` });
  if (!customer.ok) return customer;

  const invoice = await call<StripeInvoice>("POST", "/v1/invoices", {
    customer: customer.data.id,
    currency: stripeCurrency(draft.currency),
    collection_method: "send_invoice",
    days_until_due: draft.daysUntilDue,
    auto_advance: false,
    pending_invoice_items_behavior: "exclude",
    description: draft.description || undefined,
    metadata: { home_invoice_id: draft.homeInvoiceId },
  }, { ...opts, idempotencyKey: `${key}-create` });
  if (!invoice.ok) return invoice;

  try {
    await resume.onDraftCreated(invoice.data.id);
  } catch (e) {
    return { ok: false, status: 500, error: `Could not record the Stripe invoice: ${e instanceof Error ? e.message : String(e)}` };
  }

  for (const [i, item] of draft.items.entries()) {
    const added = await call("POST", "/v1/invoiceitems", {
      customer: customer.data.id,
      invoice: invoice.data.id,
      currency: stripeCurrency(draft.currency),
      amount: item.amount_minor * item.quantity,
      description: item.quantity > 1 ? `${item.description} × ${item.quantity}` : item.description,
    }, { ...opts, idempotencyKey: `${key}-item-${i}` });
    if (!added.ok) return added;
  }

  return call<StripeInvoice>("POST", `/v1/invoices/${encodeURIComponent(invoice.data.id)}/finalize`, { auto_advance: false }, {
    ...opts,
    idempotencyKey: `${key}-finalize`,
  });
}

/** Emails the finalized invoice to the client. Outward: only outside safe mode. */
export function sendInvoice(stripeInvoiceId: string, opts: StripeOptions = {}): Promise<StripeResult<StripeInvoice>> {
  return call<StripeInvoice>("POST", `/v1/invoices/${encodeURIComponent(stripeInvoiceId)}/send`, {}, {
    idempotencyKey: `send-${stripeInvoiceId}`,
    ...opts,
  });
}

export function voidInvoice(stripeInvoiceId: string, opts: StripeOptions = {}): Promise<StripeResult<StripeInvoice>> {
  return call<StripeInvoice>("POST", `/v1/invoices/${encodeURIComponent(stripeInvoiceId)}/void`, {}, opts);
}

/**
 * Takes an invoice out of Stripe the way its state allows: a draft (Stripe
 * cannot void one) is deleted, an open one is voided, one already void or
 * gone needs nothing. A paid invoice is refused: refund it in Stripe instead.
 */
export async function cancelInvoice(
  stripeInvoiceId: string,
  opts: StripeOptions = {}
): Promise<StripeResult<{ action: "deleted" | "voided" | "already_void" | "gone" }>> {
  const current = await retrieveInvoice(stripeInvoiceId, opts);
  if (!current.ok) return current.status === 404 ? { ok: true, data: { action: "gone" } } : current;
  const path = `/v1/invoices/${encodeURIComponent(stripeInvoiceId)}`;
  switch (current.data.status) {
    case "draft": {
      const removed = await call("DELETE", path, null, opts);
      return removed.ok || removed.status === 404 ? { ok: true, data: { action: "deleted" } } : removed;
    }
    case "void":
      return { ok: true, data: { action: "already_void" } };
    case "paid":
      return { ok: false, status: 409, error: "Stripe: the invoice is already paid; refund it in Stripe instead" };
    default: {
      const voided = await voidInvoice(stripeInvoiceId, opts);
      return voided.ok ? { ok: true, data: { action: "voided" } } : voided;
    }
  }
}

/** The invoice a PaymentIntent paid, for API versions whose charges no longer name it. */
export async function invoiceForPaymentIntent(paymentIntentId: string, opts: StripeOptions = {}): Promise<StripeResult<string | null>> {
  const list = await call<{ data?: Array<{ invoice?: string | { id: string } }> }>("GET", "/v1/invoice_payments", {
    payment: { type: "payment_intent", payment_intent: paymentIntentId },
    limit: 1,
  }, opts);
  if (!list.ok) return list;
  const inv = list.data.data?.[0]?.invoice;
  return { ok: true, data: typeof inv === "string" ? inv : inv?.id ?? null };
}

// ── Prices and payments ──────────────────────────────────────────────────────

export interface StripePrice {
  id: string;
  active: boolean;
  currency: string;
  unit_amount: number | null;
  recurring?: { interval?: string } | null;
}

export function retrievePrice(id: string, opts: StripeOptions = {}): Promise<StripeResult<StripePrice>> {
  return call<StripePrice>("GET", `/v1/prices/${encodeURIComponent(id)}`, null, opts);
}

/**
 * Null when a Stripe price charges what the product says; otherwise why not.
 * A product that names a stripe_price_id must charge exactly that.
 */
export function priceMismatch(
  price: StripePrice,
  product: { amount_minor: number; currency: string; kind: string; interval?: string | null }
): string | null {
  if (!price.active) return `Stripe price ${price.id} is archived`;
  if (price.unit_amount !== product.amount_minor) {
    return `Stripe price ${price.id} charges ${price.unit_amount} but the product says ${product.amount_minor}`;
  }
  if (price.currency.toUpperCase() !== product.currency.toUpperCase()) {
    return `Stripe price ${price.id} is in ${price.currency.toUpperCase()}, the product in ${product.currency}`;
  }
  const recurs = price.recurring?.interval ?? null;
  if (product.kind === "subscription" ? recurs !== product.interval : recurs !== null) {
    return `Stripe price ${price.id} ${recurs ? `recurs every ${recurs}` : "is one-off"}, which does not match the product`;
  }
  return null;
}

export interface StripePaymentIntent {
  id: string;
  metadata?: Record<string, string>;
}

export function retrievePaymentIntent(id: string, opts: StripeOptions = {}): Promise<StripeResult<StripePaymentIntent>> {
  return call<StripePaymentIntent>("GET", `/v1/payment_intents/${encodeURIComponent(id)}`, null, opts);
}

// ── Subscriptions ────────────────────────────────────────────────────────────

export interface StripeSubscription {
  id: string;
  status: string;
  metadata?: Record<string, string>;
  cancel_at_period_end?: boolean;
  current_period_end?: number;
  items?: { data?: Array<{ current_period_end?: number }> };
}

export function retrieveSubscription(id: string, opts: StripeOptions = {}): Promise<StripeResult<StripeSubscription>> {
  return call<StripeSubscription>("GET", `/v1/subscriptions/${encodeURIComponent(id)}`, null, opts);
}
