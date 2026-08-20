import { NextRequest } from "next/server";
import { authenticateSessionOrApiKey } from "@/lib/api/auth";
import { getCrmSettings } from "./settings";
import type { AdminClient } from "./types";

/**
 * Auth for public-facing capture endpoints (forms, GHL webhooks).
 * Accepts either:
 *  - x-capture-key header matching the crm_capture_key setting (simple shared
 *    key for webhook senders that can't do HMAC signing), or
 *  - the full session / signed API-key auth used everywhere else.
 */
export async function authenticateCapture(
  request: NextRequest,
  supabase: AdminClient
): Promise<{ ok: boolean; via: string }> {
  const captureKey = request.headers.get("x-capture-key");
  if (captureKey) {
    const settings = await getCrmSettings(supabase);
    if (settings.capture_key && captureKey === settings.capture_key) {
      return { ok: true, via: "capture-key" };
    }
    // Funnel workers (digital-home-funnel-starter) hold one secret and
    // send it to both the ingest and capture doors; accept the funnel
    // secret here so members configure a single value.
    if (settings.funnel_secret && captureKey === settings.funnel_secret) {
      return { ok: true, via: "funnel-secret" };
    }
    return { ok: false, via: "capture-key" };
  }
  const auth = await authenticateSessionOrApiKey(request);
  return { ok: auth.authenticated, via: auth.authenticated ? auth.mode : "none" };
}

/**
 * Auth for the funnel analytics ingest endpoint. Accepts either:
 *  - x-funnel-secret header matching the crm_funnel_secret setting (shared key
 *    for funnel workers that proxy browser beacons server-to-server), or
 *  - the full session / signed API-key auth used everywhere else.
 */
export async function authenticateFunnelIngest(
  request: NextRequest,
  supabase: AdminClient
): Promise<{ ok: boolean; via: string }> {
  const funnelSecret = request.headers.get("x-funnel-secret");
  if (funnelSecret) {
    const settings = await getCrmSettings(supabase);
    if (settings.funnel_secret && funnelSecret === settings.funnel_secret) {
      return { ok: true, via: "funnel-secret" };
    }
    return { ok: false, via: "funnel-secret" };
  }
  const auth = await authenticateSessionOrApiKey(request);
  return { ok: auth.authenticated, via: auth.authenticated ? auth.mode : "none" };
}
