/**
 * Database helpers the money code shares. Relative imports only, so the
 * tests can run it against a fake client.
 */

import type { Json } from "../../types/database.ts";
import type { MoneyClient } from "./db.ts";

type Result<T> = { data: T; error: { message: string; code?: string } | null };

/** The data, or a thrown error naming what failed. A failed read is never "nothing there". */
export function must<T>(result: Result<T>, what: string): T {
  if (result.error) throw new Error(`${what} failed: ${result.error.message}`);
  return result.data;
}

/** PostgREST answers at most 1000 rows a request; this pages until done. */
export const PAGE = 1000;

export async function selectAllIn<Row>(
  page: (from: number, to: number) => PromiseLike<Result<Row[] | null>>,
  what: string
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const batch = must(await page(from, from + PAGE - 1), what) || [];
    rows.push(...batch);
    if (batch.length < PAGE) return rows;
  }
}

/** ?limit= (1–200, default 50) and ?offset= (≥ 0). The query asks for one extra row to learn has_more. */
export function listWindow(url: string, defaultLimit = 50): { limit: number; offset: number } {
  const params = new URL(url).searchParams;
  const limit = Number(params.get("limit"));
  const offset = Number(params.get("offset"));
  return {
    limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : defaultLimit,
    offset: Number.isInteger(offset) && offset > 0 ? offset : 0,
  };
}

/** Splits the extra row off: { rows, has_more }. */
export function windowed<Row>(rows: Row[] | null, limit: number): { rows: Row[]; has_more: boolean } {
  const all = rows || [];
  return { rows: all.slice(0, limit), has_more: all.length > limit };
}

export async function readSetting(db: MoneyClient, key: string): Promise<unknown> {
  const row = must(await db.from("backend_settings").select("value").eq("key", key).maybeSingle(), `setting ${key}`);
  return row?.value ?? null;
}

/** crm_safe_mode, on unless explicitly false (same rule as lib/crm/settings.ts). */
export async function readSafeMode(db: MoneyClient): Promise<boolean> {
  return (await readSetting(db, "crm_safe_mode")) !== false;
}

/**
 * A lead timeline entry, written once per Stripe event: a retry of the same
 * event finds its entry and writes nothing. Errors throw.
 */
export async function addTimelineEntry(
  db: MoneyClient,
  entry: { lead_id: string; activity_type: string; title: string; data: Record<string, unknown>; actor: string; event_id?: string }
): Promise<boolean> {
  if (entry.event_id) {
    const seen = must(
      await db
        .from("lead_activities")
        .select("id")
        .eq("lead_id", entry.lead_id)
        .eq("activity_type", entry.activity_type)
        .eq("data->>stripe_event_id", entry.event_id)
        .limit(1),
      "timeline lookup"
    );
    if (seen && seen.length > 0) return false;
  }
  must(
    await db.from("lead_activities").insert({
      lead_id: entry.lead_id,
      activity_type: entry.activity_type,
      title: entry.title,
      data: { ...entry.data, ...(entry.event_id ? { stripe_event_id: entry.event_id } : {}) } as Json,
      actor: entry.actor,
    }),
    "timeline insert"
  );
  must(
    await db.from("leads").update({ last_activity_at: new Date().toISOString() }).eq("id", entry.lead_id),
    "lead touch"
  );
  return true;
}

export function metaOf(value: Json | null | undefined): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
