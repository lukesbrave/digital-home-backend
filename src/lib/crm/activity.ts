import { eventFromActivity, recordHomeEvent } from "@/lib/events/record";
import type { AdminClient } from "./types";
import type { Json } from "@/types/database";

export interface ActivityInput {
  lead_id: string;
  activity_type: string;
  title: string;
  body?: string | null;
  data?: Record<string, unknown>;
  actor?: string; // human | system | agent:<name>
}

export async function logActivity(supabase: AdminClient, input: ActivityInput): Promise<void> {
  const { error } = await supabase.from("lead_activities").insert({
    lead_id: input.lead_id,
    activity_type: input.activity_type,
    title: input.title,
    body: input.body ?? null,
    data: (input.data ?? {}) as Json,
    actor: input.actor ?? "system",
  });
  if (error) console.warn("logActivity failed:", error.message);

  const homeEvent = eventFromActivity(input);
  if (homeEvent) await recordHomeEvent(supabase, homeEvent);

  await supabase
    .from("leads")
    .update({ last_activity_at: new Date().toISOString() })
    .eq("id", input.lead_id);
}
