'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, EmptyState, Loading, PageHeader, useToast } from '@/components/crm/kit';

type FunnelSummary = { funnel: string; sessions: number; domain: string | null };

type FunnelStats = {
  funnel: string;
  funnels: FunnelSummary[];
  window_days: number;
  totals: { starts: number; opt_ins: number; optin_rate: number; cta_clicks: number; cta_rate: number };
  steps: { index: number; screen_id: string | null; sessions: number; pct_of_start: number; dropped: number; drop_pct: number }[];
  noise_screens: { screen_id: string; sessions: number }[];
  cta: Record<string, number>;
  daily: { date: string; sessions: number }[];
  events_scanned: number;
  truncated: boolean;
};

// Friendly labels for common funnel screen ids. Unknown ids fall back to the
// raw screen_id so any funnel/screen still renders.
const SCREEN_LABELS: Record<string, string> = {
  hook: 'Welcome (hook)',
  identity: 'Q1 · Identity',
  dream: 'Q2 · Dream',
  'check-dream': 'Affirm · dream',
  blocker: 'Q3 · Blocker',
  'check-blocker': 'Affirm · blocker',
  concept: 'Concept',
  'build-style': 'Q4 · Build style + pace',
  inventory: 'Q5 · Inventory',
  'check-inventory': 'Affirm · inventory',
  positioning: 'Positioning',
  summary: 'Summary',
  compiling: 'Generating plan',
  email: 'Email gate',
  landing: 'Plan + offer',
};

const CTA_LABELS: Record<string, string> = {
  landing: 'Plan page (in funnel)',
  plan_page: 'Emailed /plan page',
};

const WINDOWS = [
  { days: 7, label: '7d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
  { days: 0, label: 'All time' },
];

export default function FunnelAnalytics() {
  const [days, setDays] = useState(30);
  const [funnel, setFunnel] = useState('');
  const [data, setData] = useState<FunnelStats | null>(null);
  const [loading, setLoading] = useState(true);
  const { show, node: toastNode } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const fq = funnel ? `&funnel=${encodeURIComponent(funnel)}` : '';
      setData(await api<FunnelStats>(`/api/crm/funnel?days=${days}${fq}`));
    } catch (e) {
      show(e instanceof Error ? e.message : 'Failed to load', 'err');
    } finally {
      setLoading(false);
    }
  }, [days, funnel, show]);

  useEffect(() => {
    load();
  }, [load]);

  const maxDaily = data ? Math.max(1, ...data.daily.map((d) => d.sessions)) : 1;

  return (
    <div className="flex flex-col h-full">
      {toastNode}
      <PageHeader title="Funnel">
        <div className="flex items-center gap-3 flex-wrap justify-end">
          {(data?.funnels?.length ?? 0) > 1 && (
            <select
              value={funnel || data?.funnel || ''}
              onChange={(e) => setFunnel(e.target.value)}
              className="px-3 py-1.5 text-xs rounded-lg border border-minimal-border bg-minimal-row text-zinc-300 focus:outline-none focus:border-zinc-500"
              aria-label="Funnel"
            >
              {data?.funnels?.map((f) => (
                <option key={f.funnel} value={f.funnel}>
                  {f.funnel} · {f.sessions}
                </option>
              ))}
            </select>
          )}
          <div className="flex items-center gap-1">
          {WINDOWS.map((w) => (
            <button
              key={w.days}
              onClick={() => setDays(w.days)}
              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                days === w.days
                  ? 'border-minimal-border bg-minimal-row text-white'
                  : 'border-transparent text-minimal-muted hover:text-zinc-300'
              }`}
            >
              {w.label}
            </button>
          ))}
          </div>
        </div>
      </PageHeader>

      {loading || !data ? (
        <Loading />
      ) : (
        <div className="flex-1 overflow-y-auto px-12 pb-12">
          <p className="text-xs text-minimal-muted mb-6">
            {data.funnel}
            {(() => {
              const domain = data.funnels?.find((f) => f.funnel === data.funnel)?.domain;
              return domain ? ` · ${domain}` : '';
            })()}
            {data.truncated ? ' · window truncated at 50k events' : ''}
          </p>

          {/* Stat tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-minimal-border border border-minimal-border rounded-lg overflow-hidden mb-10">
            {[
              { label: 'Sessions started', value: String(data.totals.starts) },
              { label: 'Email opt-ins', value: `${data.totals.opt_ins} · ${data.totals.optin_rate}%` },
              { label: 'CTA clicks', value: String(data.totals.cta_clicks) },
              { label: 'Start → CTA', value: `${data.totals.cta_rate}%` },
            ].map((s) => (
              <div key={s.label} className="bg-minimal-bg px-5 py-6">
                <p className="text-2xl font-semibold text-white">{s.value}</p>
                <p className="text-xs text-minimal-muted mt-1.5">{s.label}</p>
              </div>
            ))}
          </div>

          {data.steps.length === 0 ? (
            <EmptyState
              title="No funnel events yet"
              hint="Events land here the moment someone opens your funnel and it posts to /api/crm/funnel/ingest. Each step counts distinct sessions, so this table is the live drop-off picture."
            />
          ) : (
            <div className="grid lg:grid-cols-3 gap-10">
              {/* Drop-off table */}
              <div className="lg:col-span-2">
                <h2 className="text-[13px] font-semibold text-zinc-300 mb-4">Drop-off by step</h2>
                <div className="border border-minimal-border rounded-lg divide-y divide-minimal-border">
                  {data.steps.map((s) => {
                    const label = (s.screen_id && SCREEN_LABELS[s.screen_id]) || s.screen_id || `Step ${s.index}`;
                    const hot = s.index > 0 && s.drop_pct >= 25 && s.dropped > 0;
                    return (
                      <div key={s.index} className="px-5 py-3">
                        <div className="flex items-baseline justify-between gap-4">
                          <p className="text-sm text-zinc-300 min-w-0 truncate">
                            <span className="text-zinc-600 tabular-nums mr-2">{s.index}</span>
                            {label}
                          </p>
                          <p className="text-xs tabular-nums shrink-0">
                            <span className="text-zinc-300">{s.sessions}</span>
                            <span className="text-zinc-600"> · {s.pct_of_start}%</span>
                            {s.index > 0 && s.dropped > 0 && (
                              <span className={hot ? 'text-red-400' : 'text-zinc-600'}>
                                {' '}
                                · −{s.drop_pct}%
                              </span>
                            )}
                          </p>
                        </div>
                        <div className="mt-2 h-1.5 rounded-full bg-minimal-row overflow-hidden">
                          <div
                            className="h-full rounded-full bg-blue-500/70"
                            style={{ width: `${Math.min(100, s.pct_of_start)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                {data.noise_screens.length > 0 && (
                  <p className="mt-3 text-[11px] text-zinc-600">
                    Excluded as version noise:{' '}
                    {data.noise_screens
                      .map((n) => `${SCREEN_LABELS[n.screen_id] || n.screen_id} (${n.sessions})`)
                      .join(', ')}
                  </p>
                )}
              </div>

              {/* CTA breakdown + daily volume */}
              <div className="flex flex-col gap-10">
                <div>
                  <h2 className="text-[13px] font-semibold text-zinc-300 mb-4">CTA clicks</h2>
                  {Object.keys(data.cta).length === 0 ? (
                    <p className="text-[13px] text-zinc-600">No CTA clicks in this window.</p>
                  ) : (
                    <div className="border border-minimal-border rounded-lg divide-y divide-minimal-border">
                      {Object.entries(data.cta).map(([location, count]) => (
                        <div key={location} className="flex items-center justify-between px-4 py-3">
                          <p className="text-sm text-zinc-300">{CTA_LABELS[location] || location}</p>
                          <p className="text-sm text-zinc-300 tabular-nums">{count}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <h2 className="text-[13px] font-semibold text-zinc-300 mb-4">Daily sessions</h2>
                  {data.daily.length === 0 ? (
                    <p className="text-[13px] text-zinc-600">No sessions in this window.</p>
                  ) : (
                    <div className="border border-minimal-border rounded-lg p-4">
                      <div className="flex items-end gap-1 h-24">
                        {data.daily.map((d) => (
                          <div
                            key={d.date}
                            title={`${d.date}: ${d.sessions}`}
                            className="flex-1 min-w-[3px] rounded-sm bg-blue-500/60"
                            style={{ height: `${Math.max(4, (d.sessions / maxDaily) * 100)}%` }}
                          />
                        ))}
                      </div>
                      <div className="flex justify-between mt-2 text-[10px] text-zinc-600 tabular-nums">
                        <span>{data.daily[0].date.slice(5)}</span>
                        <span>{data.daily[data.daily.length - 1].date.slice(5)}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
