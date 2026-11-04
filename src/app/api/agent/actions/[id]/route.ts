/**
 * POST /api/agent/actions/[id] — decide on a proposed action.
 * Body: { decision: "approve" | "reject" }
 * Approve executes immediately through the trust layer (safe-mode aware).
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateOwner, unauthorizedResponse } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import {
  AgentActionDecisionError,
  decideAgentAction,
} from "@/lib/agent/actions";
import { actorFromAuth } from "@/lib/events/shape";

/** Read the exact proposal before asking the owner for a decision in Buzz. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateOwner(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  const { id } = await params;
  const { data, error } = await createAdminClient()
    .from("agent_actions").select("*").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: "Action unavailable" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Action not found" }, { status: 404 });
  return NextResponse.json({ action: data }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateOwner(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    decision?: string;
  } | null;
  const decision = body?.decision;
  if (decision !== "approve" && decision !== "reject") {
    return NextResponse.json(
      { error: "decision must be 'approve' or 'reject'" },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();
  try {
    const result = await decideAgentAction(
      supabase,
      id,
      decision,
      actorFromAuth(auth),
    );
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Action decision failed";
    const status =
      error instanceof AgentActionDecisionError ? error.statusCode : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
