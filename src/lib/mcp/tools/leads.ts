/** leads.search, leads.get, leads.timeline, leads.add_note. */
import type { McpHandlers } from "../types.ts";
import { intArg, leadName, resolveLead, str } from "./shared.ts";

const LEAD_COLUMNS =
  "id, email, first_name, last_name, status, source, tags, score, email_status, created_at, last_activity_at";

/** PostgREST filter syntax uses these; a search term never needs them. */
function searchTerm(value: unknown): string {
  return str(value)
    .replace(/[,()"'\\*%:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function timelineCursor(entry: {
  created_at: string;
  id: string;
}): string {
  return `${entry.created_at}|${entry.id}`;
}

/** The (created_at, id) a cursor names, or null when it is not one we issued. */
export function parseTimelineCursor(
  cursor: string,
): { createdAt: string; id: string } | null {
  const bar = cursor.lastIndexOf("|");
  const createdAt = cursor.slice(0, bar);
  const id = cursor.slice(bar + 1);
  if (bar < 1 || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  // Timestamps exactly as the database returned them (microseconds kept).
  if (
    !/^\d{4}-\d{2}-\d{2}[T ][\d:.]+([+-]\d{2}(:?\d{2})?|Z)?$/.test(createdAt) ||
    !Number.isFinite(Date.parse(createdAt))
  ) {
    return null;
  }
  return { createdAt, id };
}

export const leadHandlers: McpHandlers = {
  async "leads.search"(args, { supabase }) {
    const limit = intArg(args.limit, 25);
    let query = supabase.from("leads").select(LEAD_COLUMNS).limit(limit);
    query =
      args.order_by === "score"
        ? query
            .order("score", { ascending: false })
            .order("created_at", { ascending: false })
        : query.order("created_at", { ascending: false });

    const term = searchTerm(args.query);
    if (term) {
      const like = `%${term}%`;
      const filters = [
        `email.ilike.${like}`,
        `first_name.ilike.${like}`,
        `last_name.ilike.${like}`,
      ];
      const [first, ...rest] = term.split(" ");
      if (rest.length)
        filters.push(
          `and(first_name.ilike.%${first}%,last_name.ilike.%${rest.join(" ")}%)`,
        );
      query = query.or(filters.join(","));
    }
    if (str(args.status)) query = query.eq("status", str(args.status) as "new");
    if (str(args.tag)) query = query.contains("tags", [str(args.tag)]);
    if (typeof args.since_days === "number") {
      query = query.gte(
        "created_at",
        new Date(Date.now() - args.since_days * 86_400_000).toISOString(),
      );
    }
    if (typeof args.min_score === "number")
      query = query.gte("score", args.min_score);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return {
      data: { count: data.length, leads: data },
      summary: `Found ${data.length} lead${data.length === 1 ? "" : "s"}${term ? ` for "${term}"` : ""}`,
    };
  },

  // The Operator's get_lead; the server strips capability fields (unsubscribe_token) from every result.
  async "leads.get"(args, ctx) {
    return ctx.operator("get_lead", {
      lead_id: args.lead_id,
      email: args.email,
    });
  },

  // Keyset paging on (created_at, id), newest first: no row is skipped or
  // repeated when several share a timestamp.
  async "leads.timeline"(args, { supabase }) {
    const lead = await resolveLead(supabase, args);
    const limit = intArg(args.limit, 25);
    let query = supabase
      .from("lead_activities")
      .select("id, activity_type, title, body, data, actor, created_at")
      .eq("lead_id", lead.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit);
    if (str(args.activity_type))
      query = query.eq("activity_type", str(args.activity_type));
    if (str(args.cursor)) {
      const cursor = parseTimelineCursor(str(args.cursor));
      if (!cursor)
        throw new Error("cursor must be the next_cursor of a previous page");
      query = query.or(
        `created_at.lt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.lt.${cursor.id})`,
      );
    }
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const last = data[data.length - 1];
    return {
      data: {
        lead: { id: lead.id, email: lead.email, name: leadName(lead) },
        entries: data,
        pagination_unavailable: data.length===limit&&!last?.created_at,
        next_cursor:
          data.length === limit && last?.created_at ? timelineCursor({...last,created_at:last.created_at}) : null,
      },
      summary: `Read ${data.length} timeline entr${data.length === 1 ? "y" : "ies"} for ${lead.email}`,
    };
  },

  // Inserted here rather than through logActivity, which only warns on a
  // failed insert: the agent must hear when its note did not land.
  async "leads.add_note"(args, { supabase, caller, actor, runId }) {
    const lead = await resolveLead(supabase, args);
    const { data: note, error } = await supabase
      .from("lead_activities")
      .insert({
        lead_id: lead.id,
        activity_type: "note",
        title: `Note from ${caller.agent}`,
        body: str(args.note),
        data: { via: "mcp", run_id: runId },
        actor,
      })
      .select("id, created_at")
      .single();
    if (error || !note)
      throw new Error(
        `The note was not saved: ${error?.message || "no row returned"}`,
      );
    await supabase
      .from("leads")
      .update({ last_activity_at: note.created_at ?? new Date().toISOString() })
      .eq("id", lead.id);
    return {
      data: { ok: true, note_id: note.id, lead_id: lead.id, email: lead.email },
      summary: `Added a note to ${lead.email}`,
    };
  },
};
