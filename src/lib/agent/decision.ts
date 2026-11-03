import type { AdminClient } from "../crm/types.ts";
import type { Tables, Json } from "../../types/database.ts";
import type { HomeEventActor } from "../events/shape.ts";
export type AgentAction = Tables<"agent_actions">;
export type AgentActionDecision = "approve" | "reject";
export interface AgentActionDecisionResult {
  ok: true;
  status: "rejected" | "executed";
  action: AgentAction;
  result?: Json;
}
export class AgentActionDecisionError extends Error {
  statusCode: 404 | 409 | 500;
  constructor(message: string, statusCode: 404 | 409 | 500) {
    super(message);
    this.statusCode = statusCode;
  }
}
/** Claim and decide one proposed action without allowing double execution. */
export async function decideAction(
  supabase: AdminClient,
  actionId: string,
  decision: AgentActionDecision,
  /** The authenticated owner deciding this proposal. */
  decidedBy: HomeEventActor,
  executeAgentAction: (db: AdminClient, action: AgentAction) => Promise<Json>,
  record: (
    action: AgentAction,
    event:
      | "approval.granted"
      | "approval.rejected"
      | "approval.executed"
      | "approval.failed",
    actor: HomeEventActor,
    result?: Json,
  ) => Promise<void>,
): Promise<AgentActionDecisionResult> {
  const { data: action, error } = await supabase
    .from("agent_actions")
    .select("*")
    .eq("id", actionId)
    .maybeSingle();
  if (error) throw new AgentActionDecisionError(error.message, 500);
  if (!action) throw new AgentActionDecisionError("Action not found", 404);
  if (action.status !== "proposed") {
    throw new AgentActionDecisionError(
      `Action is already ${action.status}`,
      409,
    );
  }

  const decidedAt = new Date().toISOString();
  const claimedStatus = decision === "approve" ? "approved" : "rejected";
  const { data: claimed, error: claimError } = await supabase
    .from("agent_actions")
    .update({ status: claimedStatus, decided_at: decidedAt })
    .eq("id", actionId)
    .eq("status", "proposed")
    .select("*")
    .maybeSingle();
  if (claimError) throw new AgentActionDecisionError(claimError.message, 500);
  if (!claimed) {
    throw new AgentActionDecisionError(
      "Action was already decided by another request",
      409,
    );
  }
  await record(
    claimed,
    decision === "approve" ? "approval.granted" : "approval.rejected",
    decidedBy,
  );

  if (decision === "reject") {
    return { ok: true, status: "rejected", action: claimed };
  }

  try {
    const result = await executeAgentAction(supabase, claimed);
    const executedAt = new Date().toISOString();
    const { error: saveError } = await supabase
      .from("agent_actions")
      .update({ status: "executed", result, executed_at: executedAt })
      .eq("id", actionId);
    if (saveError)
      throw new Error(
        "Action ran but its receipt could not be saved. Inspect the result before proposing it again.",
      );
    await record(claimed, "approval.executed", decidedBy, result);
    return {
      ok: true,
      status: "executed",
      action: {
        ...claimed,
        status: "executed",
        result,
        executed_at: executedAt,
      },
      result,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Execution failed";
    await supabase
      .from("agent_actions")
      .update({ status: "failed", result: { error: message } as Json })
      .eq("id", actionId);
    await record(claimed, "approval.failed", decidedBy, { error: message });
    throw new AgentActionDecisionError(message, 500);
  }
}
