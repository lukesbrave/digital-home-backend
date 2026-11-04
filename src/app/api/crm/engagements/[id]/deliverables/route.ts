/**
 * GET   /api/crm/engagements/[id]/deliverables — ?limit= (≤200, default 200) ?offset= → { deliverables, has_more }   money:read
 * POST  /api/crm/engagements/[id]/deliverables — { name, status?, due_at? }        money:write
 * PATCH /api/crm/engagements/[id]/deliverables — { deliverable_id, name?, status?, due_at?, position? }  money:write
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateSessionOrApiKey, requireScope, unauthorizedResponse } from "@/lib/api/auth";
import type { DeliverableStatus, MoneyTables } from "@/types/database";
import { moneyDb } from "@/lib/money/db";
import { DELIVERABLE_STATUSES, isUuid } from "@/lib/money/records";
import { readJson } from "@/lib/money/route-auth";
import { listWindow, windowed } from "@/lib/money/db-util";
import { tagDeliveredWhenComplete } from "@/lib/crm/fulfilment";

type Params = { params: Promise<{ id: string }> };

async function engagementExists(id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const { data, error } = await moneyDb().from("engagements").select("id").eq("id", id).maybeSingle();
  if (error) throw new Error(`engagement lookup failed: ${error.message}`);
  return !!data;
}

function dueOf(value: unknown): string | null | undefined {
  if (value === null) return null;
  const t = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

export async function GET(request: NextRequest, { params }: Params) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  const denied = requireScope(auth, "money:read");
  if (denied) return denied;
  const { id } = await params;
  if (!(await engagementExists(id))) return NextResponse.json({ error: "Engagement not found" }, { status: 404 });

  const { limit, offset } = listWindow(request.url, 200);
  const { data, error } = await moneyDb()
    .from("engagement_deliverables")
    .select("*")
    .eq("engagement_id", id)
    .order("position")
    .order("created_at")
    .range(offset, offset + limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const { rows, has_more } = windowed(data, limit);
  return NextResponse.json({ deliverables: rows, has_more });
}

export async function POST(request: NextRequest, { params }: Params) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  const denied = requireScope(auth, "money:write");
  if (denied) return denied;
  const { id } = await params;
  if (!(await engagementExists(id))) return NextResponse.json({ error: "Engagement not found" }, { status: 404 });

  const body = await readJson(request);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  const status = (body.status ?? "todo") as DeliverableStatus;
  if (!DELIVERABLE_STATUSES.includes(status)) {
    return NextResponse.json({ error: `status must be one of ${DELIVERABLE_STATUSES.join(", ")}` }, { status: 400 });
  }
  const due = body.due_at === undefined ? null : dueOf(body.due_at);
  if (due === undefined) return NextResponse.json({ error: "due_at must be an ISO date or null" }, { status: 400 });

  const db = moneyDb();
  const { count } = await db.from("engagement_deliverables").select("id", { count: "exact", head: true }).eq("engagement_id", id);
  const { data, error } = await db
    .from("engagement_deliverables")
    .insert({ engagement_id: id, name: name.slice(0, 300), status, due_at: due, position: count ?? 0 })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deliverable: data }, { status: 201 });
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  const denied = requireScope(auth, "money:write");
  if (denied) return denied;
  const { id } = await params;

  const body = await readJson(request);
  if (!isUuid(body.deliverable_id)) return NextResponse.json({ error: "deliverable_id is required" }, { status: 400 });

  const changes: MoneyTables["engagement_deliverables"]["Update"] = {};
  if ("name" in body) {
    if (typeof body.name !== "string" || !body.name.trim()) return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
    changes.name = body.name.trim().slice(0, 300);
  }
  if ("status" in body) {
    if (!DELIVERABLE_STATUSES.includes(body.status as DeliverableStatus)) {
      return NextResponse.json({ error: `status must be one of ${DELIVERABLE_STATUSES.join(", ")}` }, { status: 400 });
    }
    changes.status = body.status as DeliverableStatus;
  }
  if ("due_at" in body) {
    const due = dueOf(body.due_at);
    if (due === undefined) return NextResponse.json({ error: "due_at must be an ISO date or null" }, { status: 400 });
    changes.due_at = due;
  }
  if ("position" in body) {
    if (!Number.isInteger(body.position)) return NextResponse.json({ error: "position must be an integer" }, { status: 400 });
    changes.position = body.position as number;
  }
  if (Object.keys(changes).length === 0) return NextResponse.json({ error: "nothing to change" }, { status: 400 });

  const { data, error } = await moneyDb()
    .from("engagement_deliverables")
    .update(changes)
    .eq("id", body.deliverable_id)
    .eq("engagement_id", id)
    .select("*")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Deliverable not found on this engagement" }, { status: 404 });
  // The deliverable is saved; communication must never undo that. A tagging
  // failure is logged and reported, never a 500 (same rule as the stage path).
  let delivery: "tagged" | "pending" | "failed" | null = null;
  if (data.status === "done") {
    try {
      delivery = (await tagDeliveredWhenComplete(moneyDb(), id)) ? "tagged" : "pending";
    } catch (e) {
      console.error(`delivered tagging failed for engagement ${id}`, e);
      delivery = "failed";
    }
  }
  return NextResponse.json({ deliverable: data, ...(delivery ? { delivery } : {}) });
}
