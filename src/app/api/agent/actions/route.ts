/**
 * GET /api/agent/actions — the approvals queue.
 * ?status=proposed (default) | approved | rejected | executed | failed | all
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateOwner, unauthorizedResponse } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const auth = await authenticateOwner(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);

  const status = request.nextUrl.searchParams.get("status") || "proposed";
  if (
    !["proposed", "approved", "rejected", "executed", "failed", "all"].includes(
      status,
    )
  )
    return NextResponse.json(
      { error: "Unknown action status" },
      { status: 400 },
    );
  const supabase = createAdminClient();
  let query = supabase
    .from("agent_actions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  if (status !== "all") query = query.eq("status", status as "proposed");

  const { data, error } = await query;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(
    { actions: data || [] },
    { headers: { "Cache-Control": "no-store" } },
  );
}
