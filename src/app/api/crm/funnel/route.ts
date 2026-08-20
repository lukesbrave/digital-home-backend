/**
 * GET /api/crm/funnel — funnel drop-off stats for the dashboard (and agents).
 *
 * Query: ?funnel=my-funnel&days=30   (days=0 → all time)
 *
 * Aggregation lives in @/lib/crm/funnel so agents and the dashboard share it.
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateSessionOrApiKey, unauthorizedResponse } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { getFunnelStats, listFunnels } from "@/lib/crm/funnel";

export async function GET(request: NextRequest) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);

  const params = request.nextUrl.searchParams;
  const requestedFunnel = params.get("funnel")?.trim() || "";
  const daysRaw = Number(params.get("days") ?? "30");
  const days = Number.isFinite(daysRaw) ? Math.max(0, Math.min(3650, Math.floor(daysRaw))) : 30;

  const supabase = createAdminClient();
  try {
    // Funnels register themselves by sending events; the busiest funnel in
    // the window is the default view when none is requested.
    const funnels = await listFunnels(supabase, days);
    const funnel = requestedFunnel || funnels[0]?.funnel || "default";
    const stats = await getFunnelStats(supabase, funnel, days);
    return NextResponse.json({ ...stats, funnels });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load funnel stats" },
      { status: 500 }
    );
  }
}
