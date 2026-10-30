/**
 * Engagements — a client project at a stage. Opened by hand, or from a won
 * deal: POST /api/crm/engagements/from-deal, and onDealWon, which every
 * path that wins a deal calls (the pipeline's PATCH route and the Operator's
 * move_opportunity_stage tool, which MCP reaches too).
 *
 * Relative imports only, so the tests run it against a fake client.
 */

import type { Json, MoneyRow } from "../../types/database.ts";
import type { MoneyClient } from "./db.ts";
import { addTimelineEntry, must, readSetting } from "./db-util.ts";
import { CURRENCY_SETTING, currencyFromSetting, normalizeCurrency } from "./money.ts";
import { engagementStageChanged, type FulfilmentTrigger } from "../crm/fulfilment.ts";

export type Engagement = MoneyRow<"engagements">;

export type FromDealResult =
  | { ok: true; engagement: Engagement; created: boolean }
  | { ok: false; status: 404 | 500; error: string };

/** The Home's currency: backend_settings.money_currency, else the default. */
export async function homeCurrency(db: MoneyClient): Promise<string> {
  return currencyFromSetting(await readSetting(db, CURRENCY_SETTING));
}

/**
 * Idempotent: a deal opens at most one engagement (engagements.opportunity_id
 * is unique), so winning it twice, or a race between the pipeline and an
 * agent, returns the one already there.
 */
export async function createEngagementFromDeal(
  db: MoneyClient,
  input: { opportunityId: string; actor?: string; scope?: string | null; dueAt?: string | null },
  fire?: FulfilmentTrigger
): Promise<FromDealResult> {
  try {
    const existing = must(
      await db.from("engagements").select("*").eq("opportunity_id", input.opportunityId).maybeSingle(),
      "engagement lookup"
    );
    if (existing) return { ok: true, engagement: existing, created: false };

    const opp = must(await db.from("opportunities").select("*").eq("id", input.opportunityId).maybeSingle(), "deal lookup");
    if (!opp) return { ok: false, status: 404, error: "Opportunity not found" };

    const inserted = await db
      .from("engagements")
      .insert({
        lead_id: opp.lead_id,
        opportunity_id: opp.id,
        name: opp.name,
        stage: "brief",
        status: "active",
        scope: input.scope ?? null,
        value_minor: Math.max(0, Math.round(opp.value_cents || 0)),
        currency: normalizeCurrency(opp.currency) || (await homeCurrency(db)),
        started_at: new Date().toISOString(),
        due_at: input.dueAt ?? null,
        metadata: { source: "deal_won" } as Json,
      })
      .select("*")
      .single();

    if (inserted.error?.code === "23505") {
      // Lost the race to another caller: theirs is the engagement.
      const again = must(
        await db.from("engagements").select("*").eq("opportunity_id", input.opportunityId).maybeSingle(),
        "engagement lookup"
      );
      if (again) return { ok: true, engagement: again, created: false };
    }
    const engagement = must(inserted, "engagement insert");
    if (!engagement) throw new Error("engagement insert returned nothing");

    await addTimelineEntry(db, {
      lead_id: opp.lead_id,
      activity_type: "engagement_opened",
      title: `Engagement opened: ${opp.name}`,
      data: { engagement_id: engagement.id, opportunity_id: opp.id },
      actor: input.actor ?? "system",
    });
    await engagementStageChanged(db, engagement, null, fire);
    return { ok: true, engagement, created: true };
  } catch (e) {
    return { ok: false, status: 500, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * The won-deal hook. Never throws and never fails the deal move: a failure
 * is logged and written on the lead's timeline so the owner sees it.
 */
export async function onDealWon(
  db: MoneyClient,
  input: { opportunityId: string; leadId?: string | null; actor: string }
): Promise<FromDealResult> {
  const result = await createEngagementFromDeal(db, { opportunityId: input.opportunityId, actor: input.actor });
  if (!result.ok) {
    console.error(`engagement for won deal ${input.opportunityId} failed: ${result.error}`);
    if (input.leadId) {
      await addTimelineEntry(db, {
        lead_id: input.leadId,
        activity_type: "engagement_failed",
        title: `Engagement could not be opened: ${result.error}`,
        data: { opportunity_id: input.opportunityId },
        actor: input.actor,
      }).catch((e) => console.error("engagement failure note failed", e));
    }
  }
  return result;
}
