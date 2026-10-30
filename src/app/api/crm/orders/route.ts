/**
 * GET /api/crm/orders — newest first, with their items.                        money:read
 *   ?status=pending|trial|paid|refunded|void  ?lead_id=<uuid>  ?limit=1–200 (50)  ?offset=
 *   → { orders, has_more }
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateSessionOrApiKey, requireScope, unauthorizedResponse } from "@/lib/api/auth";
import { moneyDb } from "@/lib/money/db";
import { isUuid } from "@/lib/money/records";
import { listWindow, selectAllIn, windowed } from "@/lib/money/db-util";
import type { MoneyRow } from "@/types/database";

const STATUSES = ["pending", "trial", "paid", "refunded", "void"] as const;

export async function GET(request: NextRequest) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  const denied = requireScope(auth, "money:read");
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const db = moneyDb();
  const { limit, offset } = listWindow(request.url);
  let query = db.from("orders").select("*").order("created_at", { ascending: false }).range(offset, offset + limit);
  const status = params.get("status");
  if (status && (STATUSES as readonly string[]).includes(status)) query = query.eq("status", status as (typeof STATUSES)[number]);
  const leadId = params.get("lead_id");
  if (isUuid(leadId)) query = query.eq("lead_id", leadId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const { rows: orders, has_more } = windowed(data, limit);
  const ids = orders.map((o) => o.id);
  let items: MoneyRow<"order_items">[] = [];
  try {
    items = ids.length
      ? await selectAllIn((from, to) => db.from("order_items").select("*").in("order_id", ids).order("created_at").range(from, to), "order items")
      : [];
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  return NextResponse.json({
    orders: orders.map((o) => ({ ...o, items: items.filter((i) => i.order_id === o.id) })),
    has_more,
  });
}
