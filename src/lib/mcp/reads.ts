import type { AdminClient } from "../crm/types";
import { resolveLead } from "./tools/shared";
export async function readTool(
  db: AdminClient,
  name: string,
  args: Record<string, unknown>,
) {
  if (name === "get_lead") {
    const identity = await resolveLead(db, args);
    const { data: lead, error: leadError } = await db
      .from("leads")
      .select("*")
      .eq("id", identity.id)
      .single();
    if (leadError || !lead) throw new Error("Could not read lead");
    const { data, error } = await db
      .from("lead_activities")
      .select("id,activity_type,title,created_at")
      .eq("lead_id", lead.id)
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) throw new Error("Could not load lead timeline");
    return {
      data: { lead, activities: data },
      summary: "Read lead and recent activities",
    };
  }
  if (name === "get_content_calendar") {
    let q = db
      .from("content_calendar")
      .select("id,title,target_keyword,status,priority,created_at")
      .order("created_at", { ascending: false })
      .limit(Math.min(50, Number(args.limit) || 20));
    if (args.status) q = q.eq("status", String(args.status) as "planned");
    const { data, error } = await q;
    if (error) throw new Error("Could not load calendar");
    return { data, summary: "Read calendar" };
  }
  const { data: stages, error: se } = await db
    .from("pipeline_stages")
    .select("id,name,pipeline_id,position")
    .order("position");
  let q = db
    .from("opportunities")
    .select("id,name,lead_id,stage_id,status,value_cents,updated_at")
    .order("updated_at", { ascending: false })
    .limit(500);
  if (!args.include_closed) q = q.eq("status", "open");
  if (args.stalled_only)
    q = q.lt("updated_at", new Date(Date.now() - 7 * 86400000).toISOString());
  const { data, error } = await q;
  if (se || error) throw new Error("Could not load pipeline");
  return {
    data: { stages, deals: data, limit: 500 },
    summary: "Read pipeline",
  };
}
