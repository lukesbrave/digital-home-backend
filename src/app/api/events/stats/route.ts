/**
 * GET /api/events/stats — how many of each action in the last 24 hours and
 * the last 7 days (EVENTS.md). Same auth as GET /api/events.
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateSessionOrApiKey, requireScope, unauthorizedResponse } from "@/lib/api/auth";
import { homeEventStats } from "@/lib/events/feed";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function GET(request: NextRequest) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  const denied = requireScope(auth, "events:read");
  if (denied) return denied;

  try {
    const stats = await homeEventStats(createAdminClient());
    return NextResponse.json(stats, { headers: NO_STORE });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Event stats unavailable";
    return NextResponse.json({ error: `Event stats unavailable: ${message}` }, { status: 503, headers: NO_STORE });
  }
}
