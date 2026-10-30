/**
 * GET   /api/crm/engagements — client projects, with deliverable counts.          money:read
 *   ?status=active|paused|won|lost  ?stage=brief…closed  ?lead_id=  ?limit=  ?offset=  → { engagements, has_more }
 * POST  /api/crm/engagements — { name, lead_id?, stage?, status?, scope?,
 *                                value_minor?, currency?, started_at?, due_at? }   money:write
 * PATCH /api/crm/engagements — { id, …any of the above }                          money:write
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateSessionOrApiKey, requireScope, unauthorizedResponse } from "@/lib/api/auth";
import type { EngagementStage, EngagementStatus, Json, MoneyTables } from "@/types/database";
import { createAdminClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/crm/activity";
import { moneyDb } from "@/lib/money/db";
import { isValidAmountMinor, normalizeCurrency } from "@/lib/money/money";
import { listWindow, selectAllIn, windowed } from "@/lib/money/db-util";
import { homeCurrency } from "@/lib/money/engagements";
import { ENGAGEMENT_STAGES, ENGAGEMENT_STATUSES, isUuid, type Checked } from "@/lib/money/records";
import { actorOf, readJson } from "@/lib/money/route-auth";
import { engagementStageChanged } from "@/lib/crm/fulfilment";

type EngagementUpdate = MoneyTables["engagements"]["Update"];

function isoOrNull(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

/** The fields present in `body`, checked. */
function checkEngagement(body: Record<string, unknown>): Checked<EngagementUpdate> {
  const out: EngagementUpdate = {};
  if ("name" in body) {
    if (typeof body.name !== "string" || !body.name.trim()) return { ok: false, error: "name is required" };
    out.name = body.name.trim().slice(0, 200);
  }
  if ("lead_id" in body) {
    if (body.lead_id !== null && !isUuid(body.lead_id)) return { ok: false, error: "lead_id must be a uuid" };
    out.lead_id = body.lead_id as string | null;
  }
  if ("stage" in body) {
    if (!ENGAGEMENT_STAGES.includes(body.stage as EngagementStage)) {
      return { ok: false, error: `stage must be one of ${ENGAGEMENT_STAGES.join(", ")}` };
    }
    out.stage = body.stage as EngagementStage;
  }
  if ("status" in body) {
    if (!ENGAGEMENT_STATUSES.includes(body.status as EngagementStatus)) {
      return { ok: false, error: `status must be one of ${ENGAGEMENT_STATUSES.join(", ")}` };
    }
    out.status = body.status as EngagementStatus;
  }
  if ("scope" in body) out.scope = typeof body.scope === "string" ? body.scope.slice(0, 20_000) : null;
  if ("value_minor" in body) {
    if (!isValidAmountMinor(body.value_minor)) return { ok: false, error: "value_minor must be whole minor units" };
    out.value_minor = body.value_minor;
  }
  if ("currency" in body) {
    const currency = normalizeCurrency(body.currency);
    if (!currency) return { ok: false, error: "currency must be a three-letter ISO code" };
    out.currency = currency;
  }
  for (const key of ["started_at", "due_at"] as const) {
    if (key in body) {
      const value = isoOrNull(body[key]);
      if (value === undefined) return { ok: false, error: `${key} must be an ISO date or null` };
      out[key] = value;
    }
  }
  if ("metadata" in body) {
    if (!body.metadata || typeof body.metadata !== "object" || Array.isArray(body.metadata)) {
      return { ok: false, error: "metadata must be an object" };
    }
    out.metadata = body.metadata as Json;
  }
  return { ok: true, value: out };
}

export async function GET(request: NextRequest) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  const denied = requireScope(auth, "money:read");
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const db = moneyDb();
  const { limit, offset } = listWindow(request.url);
  let query = db.from("engagements").select("*").order("updated_at", { ascending: false }).range(offset, offset + limit);
  const status = params.get("status");
  if (status && ENGAGEMENT_STATUSES.includes(status as EngagementStatus)) query = query.eq("status", status as EngagementStatus);
  const stage = params.get("stage");
  if (stage && ENGAGEMENT_STAGES.includes(stage as EngagementStage)) query = query.eq("stage", stage as EngagementStage);
  const leadId = params.get("lead_id");
  if (isUuid(leadId)) query = query.eq("lead_id", leadId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const { rows: engagements, has_more } = windowed(data, limit);
  const ids = engagements.map((e) => e.id);
  let deliverables: Array<{ engagement_id: string; status: string }> = [];
  try {
    deliverables = ids.length
      ? await selectAllIn(
          (from, to) => db.from("engagement_deliverables").select("engagement_id, status").in("engagement_id", ids).order("id").range(from, to),
          "deliverables"
        )
      : [];
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  return NextResponse.json({
    engagements: engagements.map((e) => {
      const mine = deliverables.filter((d) => d.engagement_id === e.id);
      return { ...e, deliverables: { total: mine.length, done: mine.filter((d) => d.status === "done").length } };
    }),
    has_more,
  });
}

export async function POST(request: NextRequest) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  const denied = requireScope(auth, "money:write");
  if (denied) return denied;

  const body = await readJson(request);
  if (!("name" in body)) return NextResponse.json({ error: "name is required" }, { status: 400 });
  const checked = checkEngagement(body);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });

  const admin = createAdminClient();
  const db = moneyDb(admin);
  const { data, error } = await db
    .from("engagements")
    .insert({
      ...checked.value,
      name: checked.value.name!,
      currency: checked.value.currency || (await homeCurrency(db)),
      started_at: checked.value.started_at === undefined ? new Date().toISOString() : checked.value.started_at,
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "23503" ? 404 : 500 });

  if (data.lead_id) {
    await logActivity(admin, {
      lead_id: data.lead_id,
      activity_type: "engagement_opened",
      title: `Engagement opened: ${data.name}`,
      data: { engagement_id: data.id },
      actor: actorOf(auth),
    });
  }
  return NextResponse.json({ engagement: data }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  const denied = requireScope(auth, "money:write");
  if (denied) return denied;

  const body = await readJson(request);
  if (!isUuid(body.id)) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const changes = { ...body };
  delete changes.id;
  const checked = checkEngagement(changes);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
  if (Object.keys(checked.value).length === 0) return NextResponse.json({ error: "nothing to change" }, { status: 400 });

  const admin = createAdminClient();
  const db = moneyDb(admin);
  const { data: before } = await db.from("engagements").select("*").eq("id", body.id).maybeSingle();
  if (!before) return NextResponse.json({ error: "Engagement not found" }, { status: 404 });

  const { data, error } = await db.from("engagements").update(checked.value).eq("id", before.id).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (data.lead_id && (data.stage !== before.stage || data.status !== before.status)) {
    await logActivity(admin, {
      lead_id: data.lead_id,
      activity_type: "engagement_stage",
      title:
        data.stage !== before.stage
          ? `${data.name}: ${before.stage} → ${data.stage}`
          : `${data.name}: ${before.status} → ${data.status}`,
      data: { engagement_id: data.id, stage: data.stage, status: data.status },
      actor: actorOf(auth),
    });
  }
  await engagementStageChanged(db, data, before.stage);
  return NextResponse.json({ engagement: data });
}
