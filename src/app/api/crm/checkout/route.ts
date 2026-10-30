/**
 * POST /api/crm/checkout — { product_slug, email?, success_url, cancel_url }
 *   → { url, order_id, session_id }                         money:checkout (or money:write)
 *
 * Opens a Stripe Checkout Session for one product and records a pending
 * order. Nothing is charged or emailed here: the buyer pays on Stripe's page,
 * and checkout.session.completed (POST /api/webhooks/stripe) marks the order
 * paid. The site's buy button holds a key with only money:checkout (MONEY.md).
 *
 * 503 { error: "Stripe is not configured" } until both STRIPE_SECRET_KEY and
 * STRIPE_WEBHOOK_SECRET are set: without the webhook a paid order would
 * never be recorded. A product with a stripe_price_id must charge exactly
 * what the product says, or checkout refuses (409).
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateSessionOrApiKey, requireScope, unauthorizedResponse } from "@/lib/api/auth";
import type { Json } from "@/types/database";
import { moneyDb } from "@/lib/money/db";
import { isValidEmail, normalizeEmail } from "@/lib/crm/leads";
import { CHECKOUT_KINDS, checkReturnUrl } from "@/lib/money/records";
import {
  createCheckoutSession,
  isMoneyReady,
  keyLivemode,
  NOT_CONFIGURED,
  priceMismatch,
  retrievePrice,
  type CheckoutProduct,
} from "@/lib/money/stripe-client";
import { actorOf, readJson, stripeFailure } from "@/lib/money/route-auth";

export async function POST(request: NextRequest) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  // The narrow storefront scope, or the full money:write.
  const denied = requireScope(auth, "money:checkout");
  if (denied && requireScope(auth, "money:write")) return denied;
  if (!isMoneyReady()) return NextResponse.json({ error: NOT_CONFIGURED }, { status: 503 });

  const body = await readJson(request);
  const slug = typeof body.product_slug === "string" ? body.product_slug.trim() : "";
  const successUrl = checkReturnUrl(body.success_url);
  const cancelUrl = checkReturnUrl(body.cancel_url);
  if (!slug) return NextResponse.json({ error: "product_slug is required" }, { status: 400 });
  if (!successUrl || !cancelUrl) {
    return NextResponse.json({ error: "success_url and cancel_url must be absolute http(s) URLs" }, { status: 400 });
  }
  let email: string | null = null;
  if (body.email !== undefined && body.email !== null && body.email !== "") {
    email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
    if (!isValidEmail(email)) return NextResponse.json({ error: "email is not valid" }, { status: 400 });
  }

  const db = moneyDb();
  const found = await db.from("products").select("*").eq("slug", slug).eq("active", true).maybeSingle();
  if (found.error) return NextResponse.json({ error: found.error.message }, { status: 500 });
  const product = found.data;
  if (!product) return NextResponse.json({ error: "No active product with that slug" }, { status: 404 });
  if (!CHECKOUT_KINDS.includes(product.kind)) {
    return NextResponse.json({ error: `${product.kind} products are billed on invoices, not checkout` }, { status: 400 });
  }
  if (product.stripe_price_id) {
    const price = await retrievePrice(product.stripe_price_id);
    if (!price.ok) return stripeFailure(price);
    const mismatch = priceMismatch(price.data, product);
    if (mismatch) return NextResponse.json({ error: `${mismatch}; fix the product or the price` }, { status: 409 });
  }

  const inserted = await db
    .from("orders")
    .insert({
      email,
      status: "pending",
      total_minor: product.amount_minor,
      currency: product.currency,
      livemode: keyLivemode(),
      metadata: { product_slug: product.slug, created_by: actorOf(auth) } as Json,
    })
    .select("*")
    .single();
  if (inserted.error || !inserted.data) {
    return NextResponse.json({ error: inserted.error?.message || "order insert failed" }, { status: 500 });
  }
  const order = inserted.data;
  const item = await db
    .from("order_items")
    .insert({ order_id: order.id, product_id: product.id, quantity: 1, amount_minor: product.amount_minor });
  if (item.error) {
    await db.from("orders").delete().eq("id", order.id);
    return NextResponse.json({ error: item.error.message }, { status: 500 });
  }

  const session = await createCheckoutSession({
    product: product as CheckoutProduct,
    orderId: order.id,
    productSlug: product.slug,
    successUrl,
    cancelUrl,
    email,
  });
  if (!session.ok) {
    await db
      .from("orders")
      .update({ status: "void", metadata: { product_slug: product.slug, error: session.error } as Json })
      .eq("id", order.id);
    return stripeFailure(session);
  }

  const stamped = await db.from("orders").update({ stripe_checkout_session_id: session.data.id }).eq("id", order.id);
  if (stamped.error) return NextResponse.json({ error: stamped.error.message }, { status: 500 });
  return NextResponse.json({ url: session.data.url, order_id: order.id, session_id: session.data.id }, { status: 201 });
}
