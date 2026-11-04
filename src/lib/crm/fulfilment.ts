/** Money's small adapters to the existing CRM trigger engine. */
import type { AdminClient } from "./types.ts";
import type { TriggerEvent } from "./engine.ts";
import type { MoneyClient } from "../money/db.ts";
import type { Engagement } from "../money/engagements.ts";
import { addTimelineEntry, must } from "../money/db-util.ts";

export type FulfilmentTrigger = (db: AdminClient, event: TriggerEvent) => Promise<string[]>;

// Lazy to avoid a runtime cycle: engine -> onDealWon -> this adapter -> engine.
const engineTrigger: FulfilmentTrigger = async (db, event) =>
  (await import("./engine")).fireTrigger(db, event);

export async function engagementStageChanged(
  db: MoneyClient,
  engagement: Engagement,
  previousStage: string | null,
  fire: FulfilmentTrigger = engineTrigger
): Promise<void> {
  if (!engagement.lead_id || engagement.stage === previousStage) return;
  // Like the won-deal hook, communication must never undo a saved project move.
  try {
    const lead = must(await db.from("leads").select("*").eq("id", engagement.lead_id).maybeSingle(), "engagement lead");
    if (!lead) return;
    await fire(db as unknown as AdminClient, {
      type: "engagement_stage_changed", lead,
      data: { engagement_id: engagement.id, stage: engagement.stage, previous_stage: previousStage, engagement_name: engagement.name },
    });
  } catch (e) {
    console.error("engagement stage workflow failed", e);
  }
}

/** Called after a done PATCH, including retries. A count query avoids row caps.
 * Compare-and-swap preserves other tags and lets only one racing caller fire. */
export async function tagDeliveredWhenComplete(
  db: MoneyClient,
  engagementId: string,
  fire: FulfilmentTrigger = engineTrigger
): Promise<boolean> {
  const all = await db.from("engagement_deliverables").select("id", { count: "exact", head: true })
    .eq("engagement_id", engagementId);
  must(all, "deliverables count");
  if (!all.count) return false;
  const done = await db.from("engagement_deliverables").select("id", { count: "exact", head: true })
    .eq("engagement_id", engagementId).eq("status", "done");
  must(done, "done deliverables count");
  if (done.count !== all.count) return false;
  const engagement = must(await db.from("engagements").select("lead_id").eq("id", engagementId).maybeSingle(), "delivered engagement");
  if (!engagement?.lead_id) return false;
  for (let attempt = 0; attempt < 5; attempt++) {
    const lead = must(await db.from("leads").select("*").eq("id", engagement.lead_id).maybeSingle(), "delivered lead");
    if (!lead || (lead.tags || []).includes("delivered")) return false;
    let query = db.from("leads").update({ tags: [...(lead.tags || []), "delivered"] }).eq("id", lead.id);
    query = lead.tags === null ? query.is("tags", null) : query.eq("tags", lead.tags);
    const updated = must(await query.select("*").maybeSingle(), "delivered tag");
    if (!updated) continue;
    await addTimelineEntry(db, {
      lead_id: lead.id, activity_type: "tag_added", title: "Tag added: delivered",
      data: { tag: "delivered", engagement_id: engagementId }, actor: "system",
    });
    try {
      await fire(db as unknown as AdminClient, { type: "tag_added", lead: updated, data: { tag: "delivered" } });
    } catch (e) {
      // The tag is written; a retry would see it and not fire again, so say so loudly.
      console.error(`delivered workflow did not fire for engagement ${engagementId}; enrol the lead by hand`, e);
    }
    return true;
  }
  throw new Error("delivered tag: lead changed repeatedly; retry the completion");
}
