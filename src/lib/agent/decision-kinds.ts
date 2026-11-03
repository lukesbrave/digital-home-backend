/**
 * Which approvals-queue rows are real decisions. Shared by the Operator
 * dashboard (src/app/agent/page.tsx: Approve/Reject card or one-tap FYI) and
 * the clear_fyi_notifications sweep (src/lib/agent/tools.ts), so a row that
 * executes on approval can never be cleared as a notice.
 *
 * Email, publish and workflow rows always execute. Of the 'other' rows, a
 * Conversion Radar match executes, and so do the proposals agents file over
 * POST /api/mcp (payload.kind below; executed in src/lib/agent/proposals.ts).
 * Every other 'other' row only acknowledges.
 *
 * Pure and client-safe: no imports.
 */

/** payload.kind of the agent proposals, with the badge the dashboard shows. */
export const AGENT_PROPOSAL_KINDS = {
  pipeline_move: "Deal move",
  article_topic: "Article",
  social_draft: "Social post",
} as const;

export type AgentProposalKind = keyof typeof AGENT_PROPOSAL_KINDS;

function payloadOf(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

export function agentProposalKind(payload: unknown): AgentProposalKind | null {
  const kind = payloadOf(payload).kind;
  return typeof kind === "string" &&
    Object.prototype.hasOwnProperty.call(AGENT_PROPOSAL_KINDS, kind)
    ? (kind as AgentProposalKind)
    : null;
}

/** True when approving the row runs something, so it needs Approve and Reject. */
export function isDecisionAction(action: {
  type: string;
  payload: unknown;
}): boolean {
  if (action.type !== "other") return true;
  if (payloadOf(action.payload).alert_kind === "possible_conversion")
    return true;
  return agentProposalKind(action.payload) !== null;
}
