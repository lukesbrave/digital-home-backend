/**
 * GET /api/public/products — the Home's active products, no auth, so the
 * member's site can render prices and buy buttons. ?slug= for one.
 *
 * Only what a buyer may see: no Stripe ids, no metadata. invoice_item
 * products are left out (they are only ever billed on an invoice). The buy
 * button itself goes through the site's server, which calls
 * POST /api/crm/checkout with a signed key holding only money:checkout.
 * At most 200 products a page (?offset= for more), with has_more.
 */
import { NextRequest, NextResponse } from "next/server";
import { moneyDb } from "@/lib/money/db";
import { formatMinor } from "@/lib/money/money";
import { CHECKOUT_KINDS } from "@/lib/money/records";
import { listWindow, windowed } from "@/lib/money/db-util";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "public, max-age=60",
};

export async function GET(request: NextRequest) {
  const slug = new URL(request.url).searchParams.get("slug");
  const { limit, offset } = listWindow(request.url, 200);
  let query = moneyDb()
    .from("products")
    .select("slug, name, description, kind, amount_minor, currency, interval")
    .eq("active", true)
    .in("kind", [...CHECKOUT_KINDS])
    .order("amount_minor", { ascending: true })
    .range(offset, offset + limit);
  if (slug) query = query.eq("slug", slug);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Could not load products" }, { status: 500, headers: HEADERS });

  const { rows, has_more } = windowed(data, limit);
  const products = rows.map((p) => ({
    ...p,
    price: `${formatMinor(p.amount_minor, p.currency)}${p.interval ? ` / ${p.interval}` : ""}`,
  }));
  if (slug && products.length === 0) return NextResponse.json({ error: "Product not found" }, { status: 404, headers: HEADERS });
  return NextResponse.json({ products, has_more }, { headers: HEADERS });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: HEADERS });
}
