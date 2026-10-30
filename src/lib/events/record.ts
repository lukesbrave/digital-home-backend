/**
 * Home events — the write half. recordHomeEvent validates an event against
 * ./shape.ts and inserts it into public.home_events (EVENTS.md).
 *
 * It never throws: a receipt that fails to write is a warning in the logs,
 * never a failed capture, send or publish. Pass the service-role client
 * (createAdminClient); the table has no other grants.
 *
 * Only type imports from the framework, so `node --test` can load this file
 * with a fake client.
 */
import type { createAdminClient } from "@/lib/supabase/server";
import type { HomeEventInsert, Json } from "@/types/database";
import { isUuid, validateHomeEvent, type HomeEventInput } from "./shape.ts";

export {
  actorFromAuth,
  actorFromLabel,
  agentKeyEvent,
  approvalEvent,
  articlePublishedEvent,
  dealWonEvent,
  eventFromActivity,
  leadUpsertEvent,
  provenanceFromPayload,
  TELEGRAM_OWNER,
  type HomeEventInput,
} from "./shape.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

export type RecordResult = { ok: true; id: string; seq: number } | { ok: false; error: string };

export async function recordHomeEvent(
  supabase: AdminClient,
  event: HomeEventInput
): Promise<RecordResult> {
  try {
    const checked = validateHomeEvent(event);
    if (!checked.ok) {
      console.warn(`home_events: refused ${String(event?.action)}: ${checked.error}`);
      return checked;
    }

    const row: HomeEventInsert = {
      ...checked.event,
      payload: checked.event.payload as Json,
      evidence: checked.event.evidence as Json,
    };
    const { data, error } = await supabase
      .from("home_events")
      .insert(row)
      .select("id, seq")
      .single();
    if (error || !data) {
      const message = error?.message || "insert returned no row";
      console.warn(`home_events: ${checked.event.action} not recorded: ${message}`);
      return { ok: false, error: message };
    }
    return { ok: true, id: String(data.id), seq: Number(data.seq) };
  } catch (e) {
    const message = e instanceof Error ? e.message : "record failed";
    console.warn(`home_events: ${String(event?.action)} not recorded: ${message}`);
    return { ok: false, error: message };
  }
}

export type ScrubResult = { ok: true; deleted: number } | { ok: false; error: string };

/**
 * Deletes every home event about a lead: rows carrying its lead_id, and rows
 * whose subject is the lead. Called by the lead delete route (GDPR erasure),
 * the one exception to the stream being append-only. Never throws.
 */
export async function scrubHomeEventsForLead(
  supabase: AdminClient,
  leadId: string
): Promise<ScrubResult> {
  if (!isUuid(leadId)) return { ok: false, error: "lead id must be a uuid" };
  try {
    const { data, error } = await supabase.rpc("scrub_home_events_for_lead", { p_lead_id: leadId });
    if (error) {
      console.warn(`home_events: scrub for lead ${leadId} failed: ${error.message}`);
      return { ok: false, error: error.message };
    }
    return { ok: true, deleted: Number(data) || 0 };
  } catch (e) {
    const message = e instanceof Error ? e.message : "scrub failed";
    console.warn(`home_events: scrub for lead ${leadId} failed: ${message}`);
    return { ok: false, error: message };
  }
}
