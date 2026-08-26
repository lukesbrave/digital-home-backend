'use client';

/**
 * /crm — Command Centre. The top-down view of the whole home: one status
 * sentence, the business drawn as a flowing pipeline, what's waiting on the
 * human, and a live activity feed. This is the page that answers "what's the
 * state of my business?" in five seconds — the demo hero AND the daily front
 * door. The working screens (Leads, Pipeline, Funnel…) live in the subpages.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ACTIVITY_ICONS, fmtMoney, GhostBtn, leadName, timeAgo, useToast } from '@/components/crm/kit';

type Dashboard = {
  counts: {
    total_leads: number;
    new_this_week: number;
    active_enrollments: number;
    emails_7d: number;
    open_tasks: number;
    open_opportunities: number;
    pipeline_value_cents: number;
    pipeline_estimate_cents: number;
    won_total_cents: number;
    won_this_month_cents: number;
    won_deals: number;
  };
  upcoming_appointments: {
    id: string;
    title: string;
    starts_at: string;
    leads: { id: string; email: string; first_name: string | null; last_name: string | null } | null;
  }[];
  recent_activities: {
    id: string;
    lead_id: string;
    activity_type: string;
    title: string;
    actor: string;
    created_at: string;
    leads: { id: string; email: string; first_name: string | null; last_name: string | null } | null;
  }[];
};

type Task = {
  id: string;
  title: string;
  due_at: string | null;
  leads: { id: string; email: string; first_name: string | null; last_name: string | null } | null;
};

function StageCard({ value, label, sub, href }: { value: string; label: string; sub: string; href: string }) {
  return (
    <Link
      href={href}
      className="flex-1 min-w-0 rounded-xl border border-minimal-border bg-minimal-row px-5 py-4 hover:border-white/30 transition-colors"
    >
      <div className="text-[11px] uppercase tracking-wide text-minimal-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums truncate">{value}</div>
      <div className="mt-1 text-[11px] text-minimal-muted truncate">{sub}</div>
    </Link>
  );
}

function FlowConnector() {
  return (
    <div className="flex-none w-8 self-center" aria-hidden>
      <svg viewBox="0 0 32 8" className="w-full">
        <line
          x1="0"
          y1="4"
          x2="32"
          y2="4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="4 5"
          className="command-flow text-minimal-muted/70"
        />
      </svg>
    </div>
  );
}

export default function CommandPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [ticking, setTicking] = useState(false);
  const { show, node: toastNode } = useToast();

  const load = useCallback(async () => {
    try {
      const [dash, taskRes] = await Promise.all([
        api<Dashboard>('/api/crm/dashboard'),
        api<{ tasks: Task[] }>('/api/crm/tasks?status=open'),
      ]);
      setData(dash);
      setTasks(taskRes.tasks.slice(0, 6));
    } catch (e) {
      show(e instanceof Error ? e.message : 'Failed to load', 'err');
    }
  }, [show]);

  useEffect(() => {
    load();
    const t = setInterval(load, 20000); // the room stays live
    return () => clearInterval(t);
  }, [load]);

  const runTick = async () => {
    setTicking(true);
    try {
      const r = await api<{ due: number; emails_sent: number; emails_simulated: number; completed: number }>(
        '/api/crm/tick',
        { method: 'POST', body: '{}' }
      );
      show(`Engine ran: ${r.due} due, ${r.emails_sent} sent, ${r.emails_simulated} simulated, ${r.completed} completed`);
      load();
    } catch (e) {
      show(e instanceof Error ? e.message : 'Tick failed', 'err');
    } finally {
      setTicking(false);
    }
  };

  const completeTask = async (id: string) => {
    try {
      await api(`/api/crm/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'done' }) });
      setTasks((t) => t.filter((task) => task.id !== id));
    } catch (e) {
      show(e instanceof Error ? e.message : 'Failed', 'err');
    }
  };

  const c = data?.counts;
  const needsYou = tasks.length;

  return (
    <div className="flex-1 overflow-y-auto">
      <style>{`
        @keyframes command-flow { to { stroke-dashoffset: -9; } }
        .command-flow { animation: command-flow 0.9s linear infinite; }
      `}</style>

      {/* Same shell convention as every working screen: full width, px-12 gutters. */}
      <div className="px-12 pt-9 pb-10">
        {/* The sentence */}
        <div className="flex items-start gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-medium flex items-center gap-2.5">
              Command Centre
              <span
                className={`inline-block w-2 h-2 rounded-full ${needsYou ? 'bg-amber-500' : 'bg-emerald-500'} ${data ? '' : 'animate-pulse'}`}
              />
            </h1>
            <p className="mt-1.5 text-sm text-minimal-muted">
              {!c
                ? 'Reading the room…'
                : `${c.new_this_week} new lead${c.new_this_week === 1 ? '' : 's'} this week · ${c.emails_7d} email${c.emails_7d === 1 ? '' : 's'} sent in the last 7 days · ` +
                  (needsYou
                    ? `${needsYou} item${needsYou === 1 ? '' : 's'} waiting on you`
                    : 'nothing waiting on you — the engine is running')}
            </p>
          </div>
          <div className="ml-auto shrink-0">
            <GhostBtn onClick={runTick} disabled={ticking}>
              {ticking ? 'Running…' : '▶ Run engine'}
            </GhostBtn>
          </div>
        </div>

        {/* The flow — the business, left to right */}
        <div className="mt-7 flex items-stretch">
          <StageCard
            href="/crm/leads"
            label="Leads"
            value={String(c?.total_leads ?? '—')}
            sub={c ? `+${c.new_this_week} this week` : ''}
          />
          <FlowConnector />
          <StageCard
            href="/crm/workflows"
            label="Nurture"
            value={String(c?.active_enrollments ?? '—')}
            sub={c ? `${c.emails_7d} emails · 7 days` : ''}
          />
          <FlowConnector />
          <StageCard
            href="/crm/pipeline"
            label="Pipeline"
            value={
              !c
                ? '—'
                : c.pipeline_estimate_cents > c.pipeline_value_cents
                  ? `~${fmtMoney(c.pipeline_estimate_cents)}`
                  : c.pipeline_value_cents > 0
                    ? fmtMoney(c.pipeline_value_cents)
                    : String(c.open_opportunities)
            }
            sub={
              !c
                ? ''
                : c.pipeline_estimate_cents > c.pipeline_value_cents
                  ? `${c.open_opportunities} open deals · estimated`
                  : c.pipeline_value_cents > 0
                    ? `${c.open_opportunities} open deal${c.open_opportunities === 1 ? '' : 's'}`
                    : 'open deals — no values set yet'
            }
          />
          <FlowConnector />
          <StageCard
            href="/crm/pipeline"
            label="Revenue"
            value={c ? fmtMoney(c.won_total_cents) : '—'}
            sub={c ? `${fmtMoney(c.won_this_month_cents)} won this month · ${c.won_deals} deal${c.won_deals === 1 ? '' : 's'}` : ''}
          />
        </div>

        <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Waiting on you */}
          <div className="lg:col-span-2">
            <div className="text-[11px] uppercase tracking-wide text-minimal-muted mb-2.5">Waiting on you</div>
            <div className="rounded-xl border border-minimal-border bg-minimal-row divide-y divide-minimal-border overflow-hidden">
              {tasks.length === 0 && (
                <div className="px-5 py-8 text-center text-[13px] text-minimal-muted">
                  Nothing needs you right now — open tasks land here.
                </div>
              )}
              {tasks.map((t) => (
                <div key={t.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="shrink-0 rounded border border-minimal-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-minimal-muted">
                    task
                  </span>
                  <span className="min-w-0 truncate text-[13px]">
                    {t.title}
                    {t.leads && <span className="text-minimal-muted"> — {leadName(t.leads)}</span>}
                  </span>
                  <button
                    onClick={() => completeTask(t.id)}
                    className="ml-auto shrink-0 rounded border border-minimal-border px-2 py-0.5 text-[11px] text-minimal-muted hover:text-emerald-500 hover:border-emerald-500/50"
                  >
                    Done
                  </button>
                </div>
              ))}
            </div>

            {(data?.upcoming_appointments.length ?? 0) > 0 && (
              <>
                <div className="text-[11px] uppercase tracking-wide text-minimal-muted mt-6 mb-2.5">Coming up</div>
                <div className="rounded-xl border border-minimal-border bg-minimal-row divide-y divide-minimal-border overflow-hidden">
                  {data!.upcoming_appointments.slice(0, 4).map((a) => (
                    <div key={a.id} className="flex items-center gap-3 px-4 py-3">
                      <span className="shrink-0 text-[13px]">📅</span>
                      <span className="min-w-0 truncate text-[13px]">
                        {a.title}
                        {a.leads && <span className="text-minimal-muted"> — {leadName(a.leads)}</span>}
                      </span>
                      <span className="ml-auto shrink-0 text-[11px] text-minimal-muted">
                        {new Date(a.starts_at).toLocaleString(undefined, {
                          weekday: 'short',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Live activity */}
          <div>
            <div className="text-[11px] uppercase tracking-wide text-minimal-muted mb-2.5">Live activity</div>
            <div className="rounded-xl border border-minimal-border bg-minimal-row px-4 py-2 max-h-[420px] overflow-y-auto">
              {(data?.recent_activities.length ?? 0) === 0 && (
                <div className="py-6 text-center text-[12px] text-minimal-muted">Quiet so far — activity lands here live.</div>
              )}
              {data?.recent_activities.slice(0, 20).map((a) => (
                <Link
                  key={a.id}
                  href={`/crm/leads/${a.lead_id}`}
                  className="flex items-start gap-2.5 py-2.5 border-b border-minimal-border last:border-0 hover:opacity-80"
                >
                  <span className="shrink-0 text-[13px] leading-5">{ACTIVITY_ICONS[a.activity_type] ?? '·'}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] leading-5">{a.title}</span>
                    <span className="block text-[11px] text-minimal-muted">
                      {a.leads ? `${leadName(a.leads)} · ` : ''}
                      {timeAgo(a.created_at)}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
      {toastNode}
    </div>
  );
}
