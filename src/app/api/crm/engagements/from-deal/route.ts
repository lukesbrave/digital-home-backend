/**
 * POST /api/crm/engagements/from-deal — { opportunity_id, scope?, due_at? }       money:write
 *   → { engagement, created }
 *
 * Opens the client project for a won deal, at stage "brief". Idempotent: a
 * deal has at most one engagement, so a second call returns it with
 * created: false. The pipeline calls the same function when a deal moves to
 * a stage named "Won" or is marked won, and so does the Operator's
 * move_opportunity_stage tool.
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateSessionOrApiKey, requireScope, unauthorizedResponse } from "@/lib/api/auth";
import { createEngagementFromDeal } from "@/lib/money/engagements";
import { moneyDb } from "@/lib/money/db";
import { isUuid } from "@/lib/money/records";
import { actorOf, readJson } from "@/lib/money/route-auth";

export async function POST(request: NextRequest) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  const denied = requireScope(auth, "money:write");
  if (denied) return denied;

  const body = await readJson(request);
  if (!isUuid(body.opportunity_id)) return NextResponse.json({ error: "opportunity_id is required" }, { status: 400 });
  const due = typeof body.due_at === "string" ? Date.parse(body.due_at) : NaN;

  const result = await createEngagementFromDeal(moneyDb(), {
    opportunityId: body.opportunity_id,
    actor: actorOf(auth),
    scope: typeof body.scope === "string" ? body.scope : null,
    dueAt: Number.isFinite(due) ? new Date(due).toISOString() : null,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ engagement: result.engagement, created: result.created }, { status: result.created ? 201 : 200 });
}
