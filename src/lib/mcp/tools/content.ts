/**
 * calendar.list reads the Operator's calendar view. article.propose and
 * social.propose only queue an agent_actions proposal
 * (src/lib/agent/proposals.ts); approving it files the topic or saves the
 * draft.
 */
import { proposeArticle, proposeSocialDraft } from "../../agent/proposals.ts";
import type { McpHandlers } from "../types.ts";

export const contentHandlers: McpHandlers = {
  async "calendar.list"(args, ctx) {
    return ctx.operator("get_content_calendar", {
      status: args.status,
      limit: args.limit,
    });
  },

  async "article.propose"(args, { supabase, caller, runId }) {
    const filed = await proposeArticle(supabase, args, {
      agent: caller.agent,
      runId,
    });
    return { data: filed, summary: `Proposed: ${filed.title}` };
  },

  async "social.propose"(args, { supabase, caller, runId }) {
    const filed = await proposeSocialDraft(supabase, args, {
      agent: caller.agent,
      runId,
    });
    return { data: filed, summary: `Proposed: ${filed.title}` };
  },
};
