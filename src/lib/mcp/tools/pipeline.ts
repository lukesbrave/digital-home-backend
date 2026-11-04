/**
 * pipeline.list reads the Operator's pipeline view. pipeline.move never
 * moves a deal: it queues a pipeline_move proposal
 * (src/lib/agent/proposals.ts), and approving it is what moves the deal.
 */
import { proposePipelineMove } from "../../agent/proposals.ts";
import type { McpHandlers } from "../types.ts";

export const pipelineHandlers: McpHandlers = {
  async "pipeline.list"(args, ctx) {
    return ctx.operator("list_pipeline", {
      stalled_only: args.stalled_only,
      include_closed: args.include_closed,
    });
  },

  async "pipeline.move"(args, { supabase, caller, runId }) {
    const filed = await proposePipelineMove(supabase, args, {
      agent: caller.agent,
      runId,
    });
    return { data: filed, summary: `Proposed: ${filed.title}` };
  },
};
