/**
 * Home events — the read half behind GET /api/events and /api/events/stats.
 * Rows come back in seq order, only once settled (FEED_SETTLE_MS old), and
 * pass through redactSecrets on the way out.
 */
import type { createAdminClient } from "@/lib/supabase/server";
import type { HomeEventRow } from "@/types/database";
import { encodeCursor, FEED_SETTLE_MS, isHomeEventAction, redactSecrets, type FeedQuery } from "./shape.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface FeedEvent extends Omit<HomeEventRow, "payload" | "evidence"> {
  payload: unknown;
  evidence: unknown;
  /** The cursor that resumes right after this event. */
  cursor: string;
}

export interface FeedPage {
  events: FeedEvent[];
  /** Pass as ?since= next time. Unchanged when nothing new has settled. */
  next_cursor: string;
  has_more: boolean;
  /** Events newer than this were held back to let concurrent commits land. */
  settled_before: string;
}

const COLUMNS =
  "id, seq, occurred_at, actor_type, actor, action, subject_type, subject_id, lead_id, payload, evidence";

export async function readHomeEvents(
  supabase: AdminClient,
  query: FeedQuery,
  now: Date = new Date()
): Promise<FeedPage> {
  const settledBefore = new Date(now.getTime() - FEED_SETTLE_MS).toISOString();
  let request = supabase
    .from("home_events")
    .select(COLUMNS)
    .gt("seq", query.afterSeq)
    .lt("occurred_at", settledBefore)
    .order("seq", { ascending: true })
    .limit(query.limit + 1);
  // An exact action uses the (action, seq) index; a prefix needs LIKE.
  if (query.actionPrefix && isHomeEventAction(query.actionPrefix)) request = request.eq("action", query.actionPrefix);
  else if (query.actionPrefix) request = request.like("action", `${query.actionPrefix}%`);
  if (query.leadId) request = request.eq("lead_id", query.leadId);

  const { data, error } = await request;
  if (error) throw new Error(error.message);

  const rows = data || [];
  const page = rows.slice(0, query.limit);
  const events = page.map((row) => {
    const seq = Number(row.seq);
    return {
      ...row,
      seq,
      payload: redactSecrets(row.payload),
      evidence: redactSecrets(row.evidence),
      cursor: encodeCursor(seq),
    };
  });
  const lastSeq = events.length ? events[events.length - 1].seq : query.afterSeq;
  return {
    events,
    next_cursor: encodeCursor(lastSeq),
    has_more: rows.length > query.limit,
    settled_before: settledBefore,
  };
}

export interface ActionCounts {
  total: number;
  by_action: Record<string, number>;
}

async function countSince(supabase: AdminClient, since: Date): Promise<ActionCounts> {
  const { data, error } = await supabase.rpc("home_event_counts", { since: since.toISOString() });
  if (error) throw new Error(error.message);
  const byAction: Record<string, number> = {};
  let total = 0;
  for (const row of (data || [])) {
    const count = Number(row.count) || 0;
    byAction[row.action] = count;
    total += count;
  }
  return { total, by_action: byAction };
}

export async function homeEventStats(
  supabase: AdminClient,
  now: Date = new Date()
): Promise<{ generated_at: string; last_24h: ActionCounts; last_7d: ActionCounts }> {
  const [day, week] = await Promise.all([
    countSince(supabase, new Date(now.getTime() - 24 * 3600_000)),
    countSince(supabase, new Date(now.getTime() - 7 * 24 * 3600_000)),
  ]);
  return { generated_at: now.toISOString(), last_24h: day, last_7d: week };
}
