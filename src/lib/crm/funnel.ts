import type { AdminClient } from "./types";

const PAGE_SIZE = 1000;
const MAX_PAGES = 50; // 50k events per query window — far above current volume

type EventRow = {
  session_id: string;
  event_type: string;
  screen_index: number | null;
  screen_id: string | null;
  event_data: unknown;
  created_at: string;
};

export interface FunnelStats {
  funnel: string;
  window_days: number;
  totals: {
    starts: number;
    opt_ins: number;
    optin_rate: number;
    cta_clicks: number;
    cta_rate: number;
  };
  steps: {
    index: number; // sequential position in the funnel (0-based), not the raw screen_index
    screen_id: string | null;
    sessions: number;
    pct_of_start: number;
    dropped: number;
    drop_pct: number;
  }[];
  // Screens excluded from the linear flow as version noise (e.g. a single stale
  // session on an old build). Kept here so the data is surfaced, not hidden.
  noise_screens: { screen_id: string; sessions: number }[];
  cta: Record<string, number>;
  daily: { date: string; sessions: number }[];
  events_scanned: number;
  truncated: boolean;
}

/**
 * Aggregates funnel_events into distinct sessions per screen. Steps are grouped
 * by the stable screen_id and ordered by each screen's modal index, so a
 * funnel-version change (a screen inserted/removed, shifting later indices)
 * can't split one screen into two rows. Events are deduped client-side (one per
 * screen per session); we still count distinct session_ids so replays or
 * storage-less browsers can't inflate steps. The base (denominator) is the
 * greater of start events and first-screen views, so a dropped "start" beacon
 * can't push a step past 100%. Shared by GET /api/crm/funnel and the agent's
 * get_funnel_stats tool.
 */
export async function getFunnelStats(
  supabase: AdminClient,
  funnel = "default",
  days = 30
): Promise<FunnelStats> {
  const since = days > 0 ? new Date(Date.now() - days * 86_400_000).toISOString() : null;

  const events: EventRow[] = [];
  let truncated = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    let query = supabase
      .from("funnel_events")
      .select("session_id, event_type, screen_index, screen_id, event_data, created_at")
      .eq("funnel", funnel)
      .order("created_at", { ascending: true })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (since) query = query.gte("created_at", since);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    events.push(...((data ?? []) as EventRow[]));
    if (!data || data.length < PAGE_SIZE) break;
    if (page === MAX_PAGES - 1) truncated = true;
  }

  // ── Aggregate: distinct sessions per SCREEN, keyed by stable screen_id ──────
  // Grouping by screen_id (not the raw screen_index) keeps a screen's identity
  // stable across funnel-version changes: if an old/variant build inserts or
  // removes a screen, every later screen's numeric index shifts but its id does
  // not. Ordering uses each screen's modal (most common) index, so one stale
  // session whose indices are off by one can't split a step or reshuffle the
  // funnel — it just merges into the same screen buckets as everyone else.
  const startSessions = new Set<string>();
  const optInSessions = new Set<string>();
  const screenSessions = new Map<string, Set<string>>(); // screen key -> distinct sessions
  const screenIndexVotes = new Map<string, Map<number, number>>(); // screen key -> (index -> count)
  const ctaSessions = new Map<string, Set<string>>();
  const dailySessions = new Map<string, Set<string>>();

  // A view groups by its screen_id; legacy events without one fall back to a
  // synthetic "#<index>" key so they still count (and render as "Step N").
  const viewKey = (e: EventRow): string | null =>
    e.screen_id || (e.screen_index !== null ? `#${e.screen_index}` : null);

  for (const e of events) {
    if (e.event_type === "start") {
      startSessions.add(e.session_id);
      const day = e.created_at.slice(0, 10);
      if (!dailySessions.has(day)) dailySessions.set(day, new Set());
      dailySessions.get(day)!.add(e.session_id);
    } else if (e.event_type === "view") {
      const key = viewKey(e);
      if (!key) continue;
      if (!screenSessions.has(key)) screenSessions.set(key, new Set());
      screenSessions.get(key)!.add(e.session_id);
      if (e.screen_index !== null) {
        if (!screenIndexVotes.has(key)) screenIndexVotes.set(key, new Map());
        const votes = screenIndexVotes.get(key)!;
        votes.set(e.screen_index, (votes.get(e.screen_index) ?? 0) + 1);
      }
    } else if (e.event_type === "complete") {
      optInSessions.add(e.session_id);
    } else if (e.event_type === "cta_click") {
      const data = (e.event_data ?? {}) as Record<string, unknown>;
      const location = typeof data.location === "string" ? data.location : "unknown";
      if (!ctaSessions.has(location)) ctaSessions.set(location, new Set());
      ctaSessions.get(location)!.add(e.session_id);
    }
  }

  // Representative position for each screen = its most-voted index (ties → lower).
  const repIndex = (key: string): number => {
    const votes = screenIndexVotes.get(key);
    if (!votes || votes.size === 0) return Number.MAX_SAFE_INTEGER;
    let best = Number.MAX_SAFE_INTEGER;
    let bestCount = -1;
    for (const [idx, count] of votes) {
      if (count > bestCount || (count === bestCount && idx < best)) {
        best = idx;
        bestCount = count;
      }
    }
    return best;
  };
  const sessCount = (key: string) => screenSessions.get(key)?.size ?? 0;

  const ordered = [...screenSessions.keys()].sort((a, b) => {
    const byIndex = repIndex(a) - repIndex(b);
    if (byIndex !== 0) return byIndex;
    const bySessions = sessCount(b) - sessCount(a); // dominant screen first on ties
    if (bySessions !== 0) return bySessions;
    return a.localeCompare(b);
  });

  // Pull out out-of-flow noise left by retired/variant builds. A single linear
  // funnel only ever shrinks, so a screen that a LATER screen surpasses can't be
  // part of the current flow — it's a screen an old build interleaved (e.g. a
  // step the current funnel dropped), showing up as a dip that then "recovers".
  // We require a real dip (under half the previous kept step) so ordinary
  // beacon wobble — a step landing 1–2 under its neighbour — is never dropped.
  // Excluded screens are surfaced in noise_screens, not silently hidden.
  const kept: string[] = [];
  const noise: string[] = [];
  let prevKept = Number.POSITIVE_INFINITY;
  ordered.forEach((key, i) => {
    const s = sessCount(key);
    const laterMax = ordered.slice(i + 1).reduce((m, k) => Math.max(m, sessCount(k)), 0);
    if (laterMax > s && s < prevKept / 2) {
      noise.push(key);
    } else {
      kept.push(key);
      prevKept = s;
    }
  });

  const base = Math.max(startSessions.size, kept.length ? sessCount(kept[0]) : 0);

  const steps: FunnelStats["steps"] = [];
  let prev = base;
  kept.forEach((key, i) => {
    const sessions = sessCount(key);
    const dropped = i === 0 ? Math.max(0, base - sessions) : Math.max(0, prev - sessions);
    const denom = i === 0 ? base : prev;
    steps.push({
      index: i,
      screen_id: key.startsWith("#") ? null : key,
      sessions,
      pct_of_start: base > 0 ? Math.round((sessions / base) * 1000) / 10 : 0,
      dropped,
      drop_pct: denom > 0 ? Math.round((dropped / denom) * 1000) / 10 : 0,
    });
    prev = sessions;
  });

  const cta: Record<string, number> = {};
  let ctaTotal = 0;
  for (const [location, sessions] of ctaSessions) {
    cta[location] = sessions.size;
    ctaTotal += sessions.size;
  }

  const daily = Array.from(dailySessions.entries())
    .map(([date, sessions]) => ({ date, sessions: sessions.size }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    funnel,
    window_days: days,
    totals: {
      starts: startSessions.size,
      opt_ins: optInSessions.size,
      optin_rate: base > 0 ? Math.round((optInSessions.size / base) * 1000) / 10 : 0,
      cta_clicks: ctaTotal,
      cta_rate: base > 0 ? Math.round((ctaTotal / base) * 1000) / 10 : 0,
    },
    steps,
    noise_screens: noise.map((key) => ({ screen_id: key, sessions: sessCount(key) })),
    cta,
    daily,
    events_scanned: events.length,
    truncated,
  };
}
export interface FunnelSummary {
  funnel: string;
  sessions: number;
  /** Host of the funnel's most recent event URL, for display. */
  domain: string | null;
}

/**
 * Distinct funnels seen in the window, busiest first. A funnel registers
 * itself by sending events — the slug in the stream IS the registration;
 * there is no funnel table to maintain. Scans newest-first so the first
 * page_url met per slug is also its current domain.
 */
export async function listFunnels(supabase: AdminClient, days = 30): Promise<FunnelSummary[]> {
  const since = days > 0 ? new Date(Date.now() - days * 86_400_000).toISOString() : null;
  const map = new Map<string, { sessions: Set<string>; domain: string | null }>();
  for (let page = 0; page < MAX_PAGES; page++) {
    let query = supabase
      .from("funnel_events")
      .select("funnel, session_id, page_url")
      .order("created_at", { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (since) query = query.gte("created_at", since);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as { funnel: string | null; session_id: string; page_url: string | null }[];
    for (const r of rows) {
      const slug = r.funnel || "unknown";
      let entry = map.get(slug);
      if (!entry) {
        entry = { sessions: new Set(), domain: null };
        map.set(slug, entry);
      }
      entry.sessions.add(r.session_id);
      if (!entry.domain && r.page_url) {
        try {
          entry.domain = new URL(r.page_url).host;
        } catch {
          // Malformed page_url: leave the domain unknown.
        }
      }
    }
    if (!data || data.length < PAGE_SIZE) break;
  }
  return Array.from(map.entries())
    .map(([funnel, e]) => ({ funnel, sessions: e.sessions.size, domain: e.domain }))
    .sort((a, b) => b.sessions - a.sessions);
}
