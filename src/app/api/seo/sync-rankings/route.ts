/**
 * POST /api/seo/sync-rankings — SEO Agent
 *
 * Pulls real Google Search Console numbers (clicks, impressions, CTR,
 * average position) for every indexed page and writes them onto the
 * matching seo_meta row — the four "Performance (updated by SEO Agent)"
 * columns from migration 002 that nothing has ever filled in.
 *
 * Auth via a Google Cloud service account (webmasters.readonly), added as
 * a Restricted user on the Search Console property. No OAuth consent
 * screen, no human login, safe to run on a schedule. See SEO.md.
 */

import { NextRequest, NextResponse } from "next/server";
import { createSign } from "crypto";
import { authenticateSessionOrApiKey, unauthorizedResponse } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const GSC_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GSC_ROW_LIMIT = 5000;
// Search Console's own numbers lag 2-3 days behind real time; querying the
// trailing window ending there (instead of "today") avoids a partial,
// misleadingly-low final day in every sync.
const REPORTING_LAG_DAYS = 3;
const WINDOW_DAYS = 28;

interface SearchAnalyticsRow {
  keys?: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function buildAssertion(clientEmail: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: clientEmail,
    scope: GSC_SCOPE,
    aud: GSC_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claimSet))}`;

  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  // Secrets stores often collapse real newlines; restore them before signing.
  const pem = privateKey.includes("\\n") ? privateKey.replace(/\\n/g, "\n") : privateKey;
  const signature = signer.sign(pem);

  return `${signingInput}.${base64url(signature)}`;
}

async function getAccessToken(clientEmail: string, privateKey: string): Promise<string> {
  const assertion = buildAssertion(clientEmail, privateKey);
  const response = await fetch(GSC_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Google token exchange failed (${response.status}): ${text.slice(0, 300)}`);
  }

  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("Google token exchange returned no access_token");
  }
  return data.access_token;
}

async function queryGscRows(
  siteUrl: string,
  accessToken: string,
  startDate: string,
  endDate: string
): Promise<SearchAnalyticsRow[]> {
  const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      startDate,
      endDate,
      dimensions: ["page"],
      rowLimit: GSC_ROW_LIMIT,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Search Console query failed (${response.status}): ${text.slice(0, 500)}`);
  }

  const data = (await response.json()) as { rows?: SearchAnalyticsRow[] };
  return data.rows || [];
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Matches "https://site.com/page", "https://www.site.com/page/", "http://..." as the same page. */
function normalizePageUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${host}${path}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

export async function POST(request: NextRequest) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);

  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "";
  const siteUrl = process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL || "";

  if (!clientEmail || !privateKey || !siteUrl) {
    return NextResponse.json(
      {
        error:
          "Search Console isn't configured. Set GOOGLE_SERVICE_ACCOUNT_EMAIL, " +
          "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY and GOOGLE_SEARCH_CONSOLE_SITE_URL " +
          "as Worker secrets. See SEO.md.",
      },
      { status: 500 }
    );
  }

  const triggerSource =
    auth.mode === "api-key"
      ? { auth_mode: "api-key", triggered_by: auth.agent }
      : { auth_mode: "session", triggered_by: auth.userId };

  const supabase = createAdminClient();

  const end = new Date();
  end.setUTCDate(end.getUTCDate() - REPORTING_LAG_DAYS);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (WINDOW_DAYS - 1));
  const startDate = formatDate(start);
  const endDate = formatDate(end);

  let rows: SearchAnalyticsRow[];
  try {
    const accessToken = await getAccessToken(clientEmail, privateKey);
    rows = await queryGscRows(siteUrl, accessToken, startDate, endDate);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Search Console error";
    await supabase.from("agent_logs").insert({
      agent: "seo_agent",
      action: "sync_rankings",
      description: `Search Console sync failed: ${message}`,
      status: "failed",
      target_table: "seo_meta",
      input_data: { ...triggerSource, site_url: siteUrl } as Json,
      output_data: { error: message } as Json,
    });
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const { data: seoRows, error: seoError } = await supabase
    .from("seo_meta")
    .select("id, canonical_url");

  if (seoError) {
    return NextResponse.json({ error: `Failed to load seo_meta: ${seoError.message}` }, { status: 500 });
  }

  const byNormalizedUrl = new Map<string, string>();
  for (const row of seoRows || []) {
    if (row.canonical_url) byNormalizedUrl.set(normalizePageUrl(row.canonical_url), row.id);
  }

  let matched = 0;
  const unmatchedPages: string[] = [];

  for (const row of rows) {
    const page = row.keys?.[0];
    if (!page) continue;

    const seoMetaId = byNormalizedUrl.get(normalizePageUrl(page));
    if (!seoMetaId) {
      unmatchedPages.push(page);
      continue;
    }

    const { error: updateError } = await supabase
      .from("seo_meta")
      .update({
        current_rank: Math.round(row.position),
        impressions_30d: row.impressions,
        clicks_30d: row.clicks,
        ctr_30d: Math.round(row.ctr * 10000) / 100, // Google sends a 0-1 fraction; store as a 0-100 percentage.
      })
      .eq("id", seoMetaId);

    if (!updateError) matched++;
  }

  const rowLimitHit = rows.length === GSC_ROW_LIMIT;

  await supabase.from("agent_logs").insert({
    agent: "seo_agent",
    action: "sync_rankings",
    description: `Search Console sync: ${matched} page(s) updated from ${rows.length} row(s) returned`,
    status: "completed",
    target_table: "seo_meta",
    input_data: { ...triggerSource, site_url: siteUrl, date_range: { startDate, endDate } } as Json,
    output_data: {
      rows_returned: rows.length,
      pages_matched: matched,
      pages_unmatched: unmatchedPages.length,
      row_limit_hit: rowLimitHit,
    } as Json,
  });

  return NextResponse.json({
    success: true,
    date_range: { startDate, endDate },
    rows_returned: rows.length,
    pages_matched: matched,
    // Capped so an unverified property or a mismatched domain doesn't blow up the response.
    unmatched_pages: unmatchedPages.slice(0, 20),
    row_limit_hit: rowLimitHit,
  });
}
