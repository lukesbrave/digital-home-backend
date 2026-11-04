/**
 * GET /api/events — the home's event stream, oldest first (EVENTS.md).
 *
 *   ?since=<cursor>   resume after this cursor (omit to start from the first event)
 *   ?limit=1..500     page size, default 100
 *   ?action=<prefix>  e.g. lead. or approval.granted
 *   ?lead_id=<uuid>   one lead's events
 *
 * Returns {events, next_cursor, has_more}. Store next_cursor and pass it as
 * ?since= next time; while has_more is true, ask again straight away.
 *
 * An admin session, or a signed API key holding events:read. Read-only.
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateSessionOrApiKey, requireScope, unauthorizedResponse } from "@/lib/api/auth";
import { readHomeEvents } from "@/lib/events/feed";
import { parseFeedQuery } from "@/lib/events/shape";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function GET(request: NextRequest) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  const denied = requireScope(auth, "events:read");
  if (denied) return denied;

  const parsed = parseFeedQuery(request.nextUrl.searchParams);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400, headers: NO_STORE });

  try {
    const page = await readHomeEvents(createAdminClient(), parsed.query);
    return NextResponse.json(page, { headers: NO_STORE });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Events unavailable";
    return NextResponse.json({ error: `Events unavailable: ${message}` }, { status: 503, headers: NO_STORE });
  }
}
