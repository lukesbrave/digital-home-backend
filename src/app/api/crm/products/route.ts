/**
 * GET   /api/crm/products            — every product (?active=true for live ones)        money:read
 * POST  /api/crm/products            — { name, slug?, kind, amount_minor, currency, … }   money:write
 * PATCH /api/crm/products            — { id | slug, …fields to change }                   money:write
 *
 * Products live in the Home. Checkout prices them inline unless a
 * stripe_price_id is set, so nothing has to be created in Stripe first.
 * Active products (except invoice_item) are public via GET /api/public/products.
 * GET pages with ?limit= (≤200) and ?offset=, answering has_more and the
 * Home's currency (home_currency). Without a
 * currency a product takes backend_settings.money_currency. A stripe_price_id
 * is checked against Stripe when Stripe is connected (409 if it charges
 * something else); checkout checks it again either way.
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateSessionOrApiKey, requireScope, unauthorizedResponse } from "@/lib/api/auth";
import type { Json } from "@/types/database";
import { moneyDb } from "@/lib/money/db";
import { checkProduct, isUuid, type ProductFields } from "@/lib/money/records";
import { readJson } from "@/lib/money/route-auth";
import { listWindow, windowed } from "@/lib/money/db-util";
import { homeCurrency } from "@/lib/money/engagements";
import { isStripeConfigured, priceMismatch, retrievePrice } from "@/lib/money/stripe-client";

/** Null when the product names no Stripe price, Stripe is not connected, or the price matches. */
async function priceProblem(product: ProductFields): Promise<Response | null> {
  if (!product.stripe_price_id || !isStripeConfigured()) return null;
  const price = await retrievePrice(product.stripe_price_id);
  if (!price.ok) return NextResponse.json({ error: price.error }, { status: price.status === 404 ? 400 : price.status });
  const mismatch = priceMismatch(price.data, product);
  return mismatch ? NextResponse.json({ error: mismatch }, { status: 409 }) : null;
}

export async function GET(request: NextRequest) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  const denied = requireScope(auth, "money:read");
  if (denied) return denied;

  const { limit, offset } = listWindow(request.url, 200);
  let query = moneyDb().from("products").select("*").order("created_at", { ascending: false }).range(offset, offset + limit);
  if (new URL(request.url).searchParams.get("active") === "true") query = query.eq("active", true);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const { rows, has_more } = windowed(data, limit);
  // home_currency: what a product made without one is priced in, for forms.
  return NextResponse.json({ products: rows, has_more, home_currency: await homeCurrency(moneyDb()) });
}

export async function POST(request: NextRequest) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  const denied = requireScope(auth, "money:write");
  if (denied) return denied;

  const db = moneyDb();
  const checked = checkProduct(await readJson(request), undefined, { defaultCurrency: await homeCurrency(db) });
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
  const problem = await priceProblem(checked.value);
  if (problem) return problem;

  const { data, error } = await db
    .from("products")
    .insert({ ...checked.value, metadata: checked.value.metadata as Json })
    .select("*")
    .single();
  if (error?.code === "23505") return NextResponse.json({ error: `slug "${checked.value.slug}" is taken` }, { status: 409 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ product: data }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  const denied = requireScope(auth, "money:write");
  if (denied) return denied;

  const body = await readJson(request);
  const db = moneyDb();
  const lookup = isUuid(body.id)
    ? db.from("products").select("*").eq("id", body.id)
    : typeof body.slug === "string"
      ? db.from("products").select("*").eq("slug", body.slug)
      : null;
  if (!lookup) return NextResponse.json({ error: "id (or slug) is required" }, { status: 400 });
  const { data: existing, error: lookupError } = await lookup.maybeSingle();
  if (lookupError) return NextResponse.json({ error: lookupError.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  // Identified by slug, the slug itself is not a change.
  const changes = { ...body };
  delete changes.id;
  if (!isUuid(body.id)) delete changes.slug;

  const checked = checkProduct(changes, {
    ...existing,
    metadata: (existing.metadata || {}) as Record<string, unknown>,
  } as ProductFields);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
  if (["stripe_price_id", "amount_minor", "currency", "kind", "interval"].some((k) => k in changes)) {
    const problem = await priceProblem(checked.value);
    if (problem) return problem;
  }

  const { data, error } = await db
    .from("products")
    .update({ ...checked.value, metadata: checked.value.metadata as Json })
    .eq("id", existing.id)
    .select("*")
    .single();
  if (error?.code === "23505") return NextResponse.json({ error: "that slug is taken" }, { status: 409 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ product: data });
}
