/**
 * approvals.list shows the owner's queue. Titles and summaries name leads
 * ("Email jane@…"), so they need leads:read as well; without it a caller sees
 * each item's type, status and time only. Payloads never leave through it.
 * approvals.mine shows the caller's own proposals in full, matched on
 * payload.proposed_by.
 */
import { hasScope } from "../../api/agent-key-scopes.ts";
import type { McpHandlers } from "../types.ts";
import { intArg, str } from "./shared.ts";

type ActionStatus =
  | "proposed"
  | "approved"
  | "rejected"
  | "executed"
  | "failed";

export const approvalHandlers: McpHandlers = {
  async "approvals.list"(args, { supabase, caller }) {
    const detailed = hasScope(caller.scopes, "leads:read");
    let query = supabase
      .from("agent_actions")
      .select(
        detailed
          ? "id, type, title, summary, status, created_at, decided_at, executed_at"
          : "type, status, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(intArg(args.limit, 25));
    if (str(args.status))
      query = query.eq("status", str(args.status) as ActionStatus);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    // Projected here as well as in the select, so the restricted view never depends on the query alone.
    const rows = (
      (data || []) as unknown as Array<Record<string, unknown>>
    ).map((row) =>
      detailed
        ? row
        : { type: row.type, status: row.status, created_at: row.created_at },
    );
    const waiting = rows.filter((a) => a.status === "proposed").length;
    return {
      data: {
        count: rows.length,
        waiting,
        detail: detailed
          ? "full"
          : "type, status and time only (titles need leads:read)",
        actions: rows,
      },
      summary: `Read ${rows.length} queue item${rows.length === 1 ? "" : "s"} (${waiting} waiting)`,
    };
  },

  async "approvals.mine"(args, { supabase, caller }) {
    let query = supabase
      .from("agent_actions")
      .select(
        "id, type, title, summary, payload, status, result, created_at, decided_at, executed_at",
      )
      .contains("payload", { proposed_by: caller.agent })
      .order("created_at", { ascending: false })
      .limit(intArg(args.limit, 25));
    if (str(args.status))
      query = query.eq("status", str(args.status) as ActionStatus);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return {
      data: { agent: caller.agent, count: data.length, actions: data },
      summary: `Read ${data.length} of ${caller.agent}'s proposals`,
    };
  },
};
