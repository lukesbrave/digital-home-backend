'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  api,
  ACTIVITY_ICONS,
  Field,
  fmtDate,
  GhostBtn,
  leadName,
  Loading,
  Modal,
  PrimaryBtn,
  Select,
  StatusDot,
  TagChip,
  TextArea,
  TextInput,
  timeAgo,
  useToast,
} from '@/components/crm/kit';

type Lead = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  company: string | null;
  source: string | null;
  capture_page: string | null;
  status: string;
  email_status: string;
  score: number;
  tags: string[];
  custom: Record<string, unknown>;
  created_at: string;
  last_activity_at: string;
};

type Activity = {
  id: string;
  activity_type: string;
  title: string;
  body: string | null;
  actor: string;
  created_at: string;
  data: Record<string, unknown> | null;
};

type Appointment = {
  id: string;
  title: string;
  starts_at: string;
  status: string;
  location: string | null;
  meeting_url: string | null;
};

type VisitorRow = {
  anonymous_id: string;
  first_source: string | null;
  first_medium: string | null;
  first_campaign: string | null;
  first_referrer_domain: string | null;
  is_ai_traffic: boolean;
  ai_referrer_source: string | null;
  latest_source: string | null;
  latest_medium: string | null;
  latest_campaign: string | null;
  visit_count: number;
  first_seen_at: string;
  last_seen_at: string;
  pages_viewed: string[];
  device_type: string | null;
  browser: string | null;
  country: string | null;
  city: string | null;
};

type Detail = {
  lead: Lead;
  activities: Activity[];
  enrollments: {
    id: string;
    status: string;
    current_step: number;
    next_run_at: string;
    workflows: { id: string; name: string; status: string; steps: unknown[] } | null;
  }[];
  opportunities: { id: string; name: string; value_cents: number; status: string; pipeline_stages: { name: string } | null }[];
  tasks: { id: string; title: string; status: string; due_at: string | null }[];
  sends: { id: string; subject: string; status: string; sent_at: string | null; opened_at: string | null; clicked_at: string | null }[];
  appointments: Appointment[];
  visitors: VisitorRow[];
  funnel_first_touch: {
    funnel: string;
    landed_at: string;
    page_url: string | null;
    referrer: string | null;
    source?: string;
    medium?: string;
    campaign?: string;
    content?: string;
  } | null;
};

type SendView = {
  id: string;
  email_address: string;
  subject: string;
  body_html: string | null;
  status: string;
  step_number: number | null;
  workflow_name: string | null;
  sent_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  error_message: string | null;
  created_at: string;
};

const STATUSES = ['new', 'engaged', 'qualified', 'converted', 'lost'];

export default function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { show, node: toastNode } = useToast();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [note, setNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [showEnroll, setShowEnroll] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [viewSend, setViewSend] = useState<SendView | null>(null);
  const [tlFilter, setTlFilter] = useState<'all' | 'emails' | 'notes' | 'system'>('all');

  const openSend = async (sendId: string) => {
    try {
      const res = await api<{ send: SendView }>(`/api/crm/sends/${sendId}`);
      setViewSend(res.send);
    } catch (e) {
      show(e instanceof Error ? e.message : 'Could not load email', 'err');
    }
  };

  const load = useCallback(async () => {
    try {
      setDetail(await api<Detail>(`/api/crm/leads/${id}`));
    } catch (e) {
      show(e instanceof Error ? e.message : 'Failed to load lead', 'err');
    }
  }, [id, show]);

  useEffect(() => {
    load();
  }, [load]);

  const patch = async (updates: Record<string, unknown>, okMsg = 'Saved') => {
    try {
      const res = await api<{ lead: Lead }>(`/api/crm/leads/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
      setDetail((d) => (d ? { ...d, lead: res.lead } : d));
      show(okMsg);
      // Refresh timeline shortly after (activities are written async)
      setTimeout(load, 400);
    } catch (e) {
      show(e instanceof Error ? e.message : 'Save failed', 'err');
    }
  };

  const addNote = async () => {
    if (!note.trim()) return;
    setSavingNote(true);
    try {
      await api(`/api/crm/leads/${id}/notes`, { method: 'POST', body: JSON.stringify({ body: note }) });
      setNote('');
      load();
    } catch (e) {
      show(e instanceof Error ? e.message : 'Note failed', 'err');
    } finally {
      setSavingNote(false);
    }
  };

  const deleteLead = async () => {
    try {
      await api(`/api/crm/leads/${id}`, { method: 'DELETE' });
      router.push('/crm/leads');
    } catch (e) {
      show(e instanceof Error ? e.message : 'Delete failed', 'err');
    }
  };

  if (!detail) {
    return (
      <div className="flex flex-col h-full">
        <header className="h-20 px-12 flex items-center shrink-0">
          <Link href="/crm/leads" className="text-xs text-minimal-muted hover:text-white">
            ← Leads
          </Link>
        </header>
        <Loading />
      </div>
    );
  }

  const { lead } = detail;

  // Everything the lead has filled in or been stamped with — funnel and
  // application answers land in `custom`; show all of it, read-only.
  const collected = Object.entries(lead.custom || {});

  const visitor = detail.visitors[0] ?? null;
  const ft = detail.funnel_first_touch;

  // At-a-glance: what's next for this lead.
  const nowMs = Date.now();
  const nextAppt =
    [...detail.appointments]
      .filter((a) => a.status === 'scheduled' && new Date(a.starts_at).getTime() > nowMs)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0] ?? null;
  const openTasks = detail.tasks.filter((t) => t.status === 'open');

  // One timeline: activities and appointments interleaved, grouped by day.
  const allTimeline = [
    ...detail.activities.map((a) => ({ ts: a.created_at, kind: 'activity' as const, a })),
    ...detail.appointments.map((ap) => ({ ts: ap.starts_at, kind: 'appointment' as const, ap })),
  ].sort((x, y) => y.ts.localeCompare(x.ts));
  const category = (item: (typeof allTimeline)[number]) =>
    item.kind === 'appointment'
      ? 'system'
      : item.a.activity_type.startsWith('email')
        ? 'emails'
        : item.a.activity_type === 'note'
          ? 'notes'
          : 'system';
  const timeline =
    tlFilter === 'all' ? allTimeline : allTimeline.filter((i) => category(i) === tlFilter);
  const timelineDays: { day: string; items: typeof timeline }[] = [];
  for (const item of timeline) {
    const day = new Date(item.ts).toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    const last = timelineDays[timelineDays.length - 1];
    if (last && last.day === day) last.items.push(item);
    else timelineDays.push({ day, items: [item] });
  }

  return (
    <div className="flex flex-col h-full">
      {toastNode}
      <header className="h-20 px-12 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-6 min-w-0">
          <Link href="/crm/leads" className="text-xs text-minimal-muted hover:text-white shrink-0">
            ← Leads
          </Link>
          <h1 className="text-sm font-medium text-white truncate">{leadName(lead)}</h1>
          <StatusDot status={lead.status} />
        </div>
        <div className="flex items-center gap-3">
          <GhostBtn onClick={() => setShowCompose(true)}>Send email</GhostBtn>
          <GhostBtn onClick={() => setShowEnroll(true)}>Enroll in workflow</GhostBtn>
          <GhostBtn danger onClick={() => setConfirmDelete(true)}>
            Delete
          </GhostBtn>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-12 pb-12">
        {/* At-a-glance strip: who is this and what's next, before any scrolling. */}
        <div className="flex flex-wrap items-center gap-x-7 gap-y-2 pb-6 text-[13px]">
          <Glance label="Score">{lead.score}</Glance>
          <Glance label="Source">{lead.source || '—'}</Glance>
          <Glance label="Created">{fmtDate(lead.created_at)}</Glance>
          <Glance label="Next appointment">
            {nextAppt ? (
              <>
                {nextAppt.title} · {fmtDate(nextAppt.starts_at)}
              </>
            ) : (
              <span className="text-zinc-600">none booked</span>
            )}
          </Glance>
          {openTasks.length > 0 && (
            <Glance label="Open tasks">
              {openTasks[0].title}
              {openTasks[0].due_at ? ` · due ${fmtDate(openTasks[0].due_at)}` : ''}
              {openTasks.length > 1 ? ` · +${openTasks.length - 1} more` : ''}
            </Glance>
          )}
        </div>

        <div className="grid lg:grid-cols-5 gap-10">
          {/* Left: profile */}
          <div className="lg:col-span-2 flex flex-col gap-8">
            {/* Core fields */}
            <section className="border border-minimal-border rounded-lg p-6 flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="First name">
                  <InlineText value={lead.first_name || ''} onSave={(v) => patch({ first_name: v })} />
                </Field>
                <Field label="Last name">
                  <InlineText value={lead.last_name || ''} onSave={(v) => patch({ last_name: v })} />
                </Field>
              </div>
              <Field label="Email">
                <InlineText value={lead.email} onSave={(v) => patch({ email: v })} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Phone">
                  <InlineText value={lead.phone || ''} onSave={(v) => patch({ phone: v })} />
                </Field>
                <Field label="Company">
                  <InlineText value={lead.company || ''} onSave={(v) => patch({ company: v })} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Status">
                  <Select value={lead.status} onChange={(e) => patch({ status: e.target.value }, `Status → ${e.target.value}`)}>
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Email subscription">
                  <Select
                    value={lead.email_status}
                    onChange={(e) => patch({ email_status: e.target.value }, `Email status → ${e.target.value}`)}
                  >
                    {['subscribed', 'unsubscribed', 'bounced', 'complained'].map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            </section>

            {/* Attribution — where this lead actually came from */}
            <section className="border border-minimal-border rounded-lg p-6">
              <h3 className="text-[13px] font-semibold text-zinc-300 mb-3">Attribution</h3>
              <div className="flex flex-col gap-2.5 text-[13px]">
                <AttrRow label="Captured via">
                  {lead.source || '—'}
                  {lead.capture_page ? ` · ${lead.capture_page}` : ''} · {fmtDate(lead.created_at)}
                </AttrRow>
                {ft && (
                  <>
                    <AttrRow label="Funnel entry">
                      {ft.funnel} · {fmtDate(ft.landed_at)}
                    </AttrRow>
                    {(ft.source || ft.medium || ft.campaign) && (
                      <AttrRow label="Campaign">
                        {[ft.source, ft.medium].filter(Boolean).join(' / ') || '—'}
                        {ft.campaign ? ` · ${ft.campaign}` : ''}
                        {ft.content ? ` · ${ft.content}` : ''}
                      </AttrRow>
                    )}
                    {ft.referrer && <AttrRow label="Referrer">{ft.referrer}</AttrRow>}
                  </>
                )}
                {visitor ? (
                  <>
                    <AttrRow label="Site first touch">
                      {visitor.first_source || 'direct'}
                      {visitor.first_medium ? ` / ${visitor.first_medium}` : ''}
                      {visitor.first_campaign ? ` · ${visitor.first_campaign}` : ''}
                      {visitor.first_referrer_domain ? ` · via ${visitor.first_referrer_domain}` : ''}
                      {visitor.is_ai_traffic && (
                        <span className="ml-2 text-[11px] text-purple-400">
                          AI traffic{visitor.ai_referrer_source ? ` · ${visitor.ai_referrer_source}` : ''}
                        </span>
                      )}
                    </AttrRow>
                    <AttrRow label="Visits">
                      {visitor.visit_count} · first {fmtDate(visitor.first_seen_at)} · last{' '}
                      {timeAgo(visitor.last_seen_at)}
                    </AttrRow>
                    {(visitor.device_type || visitor.country) && (
                      <AttrRow label="Device">
                        {[visitor.device_type, visitor.browser, [visitor.city, visitor.country].filter(Boolean).join(', ')]
                          .filter(Boolean)
                          .join(' · ')}
                      </AttrRow>
                    )}
                    {visitor.pages_viewed?.length > 0 && (
                      <AttrRow label="Pages read">
                        <span className="text-zinc-400">
                          {visitor.pages_viewed.slice(0, 6).join(' · ')}
                          {visitor.pages_viewed.length > 6
                            ? ` · +${visitor.pages_viewed.length - 6} more`
                            : ''}
                        </span>
                      </AttrRow>
                    )}
                  </>
                ) : (
                  !ft && (
                    <p className="text-zinc-600">
                      No website or funnel session is linked to this lead — attribution starts at
                      capture.
                    </p>
                  )
                )}
              </div>
            </section>

            {/* Everything this lead has submitted or been stamped with —
                funnel/application answers, conversion attribution, etc. */}
            {collected.length > 0 && (
              <section className="border border-minimal-border rounded-lg p-6">
                <h3 className="text-[13px] font-semibold text-zinc-300 mb-3">Collected data</h3>
                <div className="flex flex-col gap-2.5 text-[13px]">
                  {collected.map(([key, value]) => (
                    <div key={key} className="grid grid-cols-[minmax(100px,35%)_1fr] gap-3">
                      <span className="text-zinc-600 break-words">{key.replace(/_/g, ' ')}</span>
                      <span className="text-zinc-300 break-words whitespace-pre-wrap">
                        {value === null || value === undefined
                          ? '—'
                          : typeof value === 'object'
                            ? JSON.stringify(value, null, 1)
                            : String(value)}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Tags */}
            <section className="border border-minimal-border rounded-lg p-6">
              <h3 className="text-[13px] font-semibold text-zinc-300 mb-3">Tags</h3>
              <div className="flex flex-wrap gap-2 mb-3">
                {lead.tags.length === 0 && <span className="text-[13px] text-zinc-600">No tags</span>}
                {lead.tags.map((t) => (
                  <TagChip key={t} tag={t} onRemove={() => patch({ tags: lead.tags.filter((x) => x !== t) }, `Removed "${t}"`)} />
                ))}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const t = tagInput.trim();
                  if (t && !lead.tags.includes(t)) {
                    patch({ tags: [...lead.tags, t] }, `Added "${t}"`);
                  }
                  setTagInput('');
                }}
              >
                <TextInput
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  placeholder="Add tag + Enter (fires tag triggers)"
                />
              </form>
            </section>

            {/* Workflows + opportunities + emails */}
            <section className="border border-minimal-border rounded-lg p-6">
              <h3 className="text-[13px] font-semibold text-zinc-300 mb-3">Workflows</h3>
              {detail.enrollments.length === 0 ? (
                <p className="text-[13px] text-zinc-600">Not enrolled in any workflow.</p>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {detail.enrollments.map((en) => (
                    <div key={en.id} className="flex items-center justify-between gap-3">
                      <Link
                        href={`/crm/workflows/${en.workflows?.id}`}
                        className="text-sm text-zinc-300 hover:text-white truncate"
                      >
                        {en.workflows?.name || 'Workflow'}
                      </Link>
                      <span
                        className={`text-xs font-medium capitalize shrink-0 ${
                          en.status === 'active'
                            ? 'text-green-400'
                            : en.status === 'completed'
                              ? 'text-zinc-400'
                              : 'text-red-400'
                        }`}
                      >
                        {en.status === 'active'
                          ? `step ${en.current_step + 1}/${(en.workflows?.steps as unknown[])?.length ?? '?'} · next ${timeAgo(en.next_run_at).replace(' ago', '')}`
                          : en.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <h3 className="text-[13px] font-semibold text-zinc-300 mt-6 mb-3">
                Opportunities
              </h3>
              {detail.opportunities.length === 0 ? (
                <p className="text-[13px] text-zinc-600">
                  None —{' '}
                  <Link href="/crm/pipeline" className="text-zinc-400 underline underline-offset-2">
                    add them on the pipeline board
                  </Link>
                  .
                </p>
              ) : (
                detail.opportunities.map((o) => (
                  <p key={o.id} className="text-sm text-zinc-300">
                    {o.name} · {o.pipeline_stages?.name || '—'} ·{' '}
                    <span className={`capitalize ${o.status === 'won' ? 'text-green-400' : o.status === 'lost' ? 'text-red-400' : 'text-zinc-500'}`}>
                      {o.status}
                    </span>
                  </p>
                ))
              )}

              <h3 className="text-[13px] font-semibold text-zinc-300 mt-6 mb-3">
                Recent emails
              </h3>
              {detail.sends.length === 0 ? (
                <p className="text-[13px] text-zinc-600">No emails yet.</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {detail.sends.slice(0, 8).map((s) => (
                    <button
                      key={s.id}
                      onClick={() => openSend(s.id)}
                      title="View the email as it was sent"
                      className="flex items-center justify-between gap-3 text-[13px] text-left px-2 py-1 -mx-2 rounded hover:bg-minimal-row transition-colors group"
                    >
                      <span className="text-zinc-400 group-hover:text-white truncate">{s.subject}</span>
                      <span className="text-xs text-zinc-600 shrink-0">
                        {s.status}
                        {s.opened_at ? ' · opened' : ''}
                        {s.clicked_at ? ' · clicked' : ''}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Right: timeline */}
          <div className="lg:col-span-3">
            <div className="flex gap-2 mb-4">
              {(['all', 'emails', 'notes', 'system'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setTlFilter(f)}
                  className={`px-3 py-1 rounded-full text-xs capitalize border transition-colors ${
                    tlFilter === f
                      ? 'border-zinc-500 text-white'
                      : 'border-minimal-border text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            <div className="mb-5">
              <TextArea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Write a note… (⌘+Enter to save)"
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') addNote();
                }}
              />
              <div className="flex justify-end mt-2">
                <GhostBtn onClick={addNote} disabled={savingNote || !note.trim()}>
                  {savingNote ? 'Saving…' : 'Add note'}
                </GhostBtn>
              </div>
            </div>

            <div className="relative pl-5 before:absolute before:left-[5px] before:top-2 before:bottom-2 before:w-px before:bg-minimal-border">
              {timelineDays.map(({ day, items }) => (
                <div key={day}>
                  <p className="relative -ml-5 mb-4 text-[11px] font-medium text-zinc-500 uppercase tracking-wide">
                    {day}
                  </p>
                  {items.map((item) =>
                    item.kind === 'appointment' ? (
                      <div key={`appt-${item.ap.id}`} className="relative mb-6 fade-in">
                        <span className="absolute -left-5 top-0.5 w-[11px] h-[11px] rounded-full bg-minimal-bg border border-minimal-border" />
                        <div className="flex items-baseline justify-between gap-4">
                          <p className="text-sm text-zinc-300">
                            <span className="text-minimal-muted mr-2">◷</span>
                            Appointment: {item.ap.title}
                            <span
                              className={`ml-2 text-xs capitalize ${
                                item.ap.status === 'cancelled' || item.ap.status === 'no_show'
                                  ? 'text-red-400'
                                  : item.ap.status === 'completed'
                                    ? 'text-green-400'
                                    : 'text-zinc-500'
                              }`}
                            >
                              {item.ap.status.replace('_', ' ')}
                            </span>
                          </p>
                          <span className="text-xs text-zinc-600 shrink-0" title={fmtDate(item.ap.starts_at)}>
                            {timeAgo(item.ap.starts_at)}
                          </span>
                        </div>
                        {(item.ap.location || item.ap.meeting_url) && (
                          <p className="text-[13px] text-zinc-500 mt-1 truncate">
                            {item.ap.meeting_url || item.ap.location}
                          </p>
                        )}
                      </div>
                    ) : (
                      <div key={item.a.id} className="relative mb-6 fade-in">
                        <span className="absolute -left-5 top-0.5 w-[11px] h-[11px] rounded-full bg-minimal-bg border border-minimal-border flex items-center justify-center text-[7px] text-zinc-500" />
                        <div className="flex items-baseline justify-between gap-4">
                          {typeof item.a.data?.send_id === 'string' ? (
                            <button
                              onClick={() => openSend(item.a.data!.send_id as string)}
                              title="View the email as it was sent"
                              className="text-sm text-zinc-300 text-left hover:text-white transition-colors group"
                            >
                              <span className="text-minimal-muted mr-2">
                                {ACTIVITY_ICONS[item.a.activity_type] || '·'}
                              </span>
                              <span className="underline-offset-2 group-hover:underline">{item.a.title}</span>
                            </button>
                          ) : (
                            <p className="text-sm text-zinc-300">
                              <span className="text-minimal-muted mr-2">
                                {ACTIVITY_ICONS[item.a.activity_type] || '·'}
                              </span>
                              {item.a.title}
                            </p>
                          )}
                          <span className="text-xs text-zinc-600 shrink-0" title={fmtDate(item.a.created_at)}>
                            {timeAgo(item.a.created_at)}
                          </span>
                        </div>
                        {item.a.body && (
                          <p className="text-[13px] text-zinc-500 mt-1.5 whitespace-pre-wrap leading-relaxed border-l border-minimal-border pl-3">
                            {item.a.body}
                          </p>
                        )}
                        <p className="text-xs text-zinc-700 mt-1">{item.a.actor}</p>
                      </div>
                    )
                  )}
                </div>
              ))}
              {timeline.length === 0 && (
                <p className="text-[13px] text-zinc-600">
                  {tlFilter === 'all' ? 'No activity yet.' : `No ${tlFilter === 'system' ? 'system events' : tlFilter} for this lead.`}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {viewSend && (
        <Modal title={viewSend.subject} onClose={() => setViewSend(null)} wide>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500 mb-4">
            <span>To {viewSend.email_address}</span>
            <span>{fmtDate(viewSend.sent_at || viewSend.created_at)}</span>
            <span className="capitalize">{viewSend.status}</span>
            {viewSend.workflow_name && (
              <span>
                {viewSend.workflow_name}
                {viewSend.step_number != null ? ` · step ${viewSend.step_number + 1}` : ''}
              </span>
            )}
            {viewSend.opened_at && <span className="text-green-400">opened {timeAgo(viewSend.opened_at)}</span>}
            {viewSend.clicked_at && <span className="text-green-400">clicked {timeAgo(viewSend.clicked_at)}</span>}
            {viewSend.error_message && <span className="text-red-400">{viewSend.error_message}</span>}
          </div>
          {viewSend.body_html ? (
            <iframe
              srcDoc={viewSend.body_html}
              sandbox=""
              className="w-full h-[60vh] bg-white rounded-lg"
              title="Email as sent"
            />
          ) : (
            <p className="text-[13px] text-zinc-500">
              No stored body for this send — it {viewSend.status === 'suppressed' ? 'was suppressed before rendering' : 'predates body capture'}.
            </p>
          )}
        </Modal>
      )}

      {showCompose && (
        <ComposeModal
          leadId={id}
          leadEmail={lead.email}
          emailStatus={lead.email_status}
          onClose={() => setShowCompose(false)}
          onDone={(msg, ok) => {
            setShowCompose(false);
            show(msg, ok ? 'ok' : 'err');
            load();
          }}
        />
      )}

      {showEnroll && (
        <EnrollModal
          leadId={id}
          onClose={() => setShowEnroll(false)}
          onDone={(msg, ok) => {
            setShowEnroll(false);
            show(msg, ok ? 'ok' : 'err');
            load();
          }}
        />
      )}

      {confirmDelete && (
        <Modal title="Delete this lead?" onClose={() => setConfirmDelete(false)}>
          <p className="text-sm text-zinc-400 leading-relaxed mb-6">
            Permanently deletes {lead.email}, their timeline, enrollments and email history. This is the GDPR
            &quot;forget me&quot; path — it cannot be undone.
          </p>
          <div className="flex justify-end gap-3">
            <GhostBtn onClick={() => setConfirmDelete(false)}>Cancel</GhostBtn>
            <GhostBtn danger onClick={deleteLead}>
              Delete permanently
            </GhostBtn>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Glance({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span>
      <span className="text-zinc-600">{label}</span>
      <span className="text-zinc-300 ml-2">{children}</span>
    </span>
  );
}

function ComposeModal({
  leadId,
  leadEmail,
  emailStatus,
  onClose,
  onDone,
}: {
  leadId: string;
  leadEmail: string;
  emailStatus: string;
  onClose: () => void;
  onDone: (msg: string, ok: boolean) => void;
}) {
  const [subject, setSubject] = useState('');
  const [bodyMd, setBodyMd] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    try {
      const res = await api<{ result: { status: string; error?: string } }>(
        `/api/crm/leads/${leadId}/email`,
        { method: 'POST', body: JSON.stringify({ subject, body_md: bodyMd }) }
      );
      const s = res.result.status;
      onDone(
        s === 'sent'
          ? `Email sent to ${leadEmail}`
          : s === 'simulated'
            ? 'Simulated (safe mode) — logged to the timeline, not delivered'
            : s === 'suppressed'
              ? 'Suppressed — this lead is not emailable'
              : `Send ${s}`,
        s === 'sent' || s === 'simulated'
      );
    } catch (e) {
      onDone(e instanceof Error ? e.message : 'Send failed', false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Email ${leadEmail}`} onClose={onClose} wide>
      <div className="flex flex-col gap-4">
        {emailStatus !== 'subscribed' && (
          <p className="px-3 py-2 border border-amber-900/60 bg-amber-950/30 rounded text-[13px] text-amber-300">
            This lead is {emailStatus} — the engine will suppress this send.
          </p>
        )}
        <Field label="Subject">
          <TextInput value={subject} onChange={(e) => setSubject(e.target.value)} />
        </Field>
        <Field label="Body">
          <TextArea rows={10} value={bodyMd} onChange={(e) => setBodyMd(e.target.value)} />
        </Field>
        <p className="text-xs text-zinc-600 leading-relaxed">
          Markdown. Merge tags like {'{{first_name}}'} render at send. Goes through the normal
          engine — suppression and safe mode apply, and the send lands on the timeline with an
          unsubscribe link.
        </p>
        <div className="flex justify-end gap-3">
          <GhostBtn onClick={onClose}>Cancel</GhostBtn>
          <PrimaryBtn onClick={send} disabled={busy || !subject.trim() || !bodyMd.trim()}>
            {busy ? 'Sending…' : 'Send'}
          </PrimaryBtn>
        </div>
      </div>
    </Modal>
  );
}

function AttrRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(100px,35%)_1fr] gap-3">
      <span className="text-zinc-600">{label}</span>
      <span className="text-zinc-300 break-words">{children}</span>
    </div>
  );
}

function InlineText({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <TextInput
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v !== value) onSave(v);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function EnrollModal({
  leadId,
  onClose,
  onDone,
}: {
  leadId: string;
  onClose: () => void;
  onDone: (msg: string, ok: boolean) => void;
}) {
  const [workflows, setWorkflows] = useState<{ id: string; name: string; status: string }[]>([]);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ workflows: { id: string; name: string; status: string }[] }>('/api/crm/workflows')
      .then((r) => setWorkflows(r.workflows.filter((w) => w.status === 'active')))
      .catch(() => {});
  }, []);

  const enroll = async () => {
    setBusy(true);
    try {
      await api(`/api/crm/leads/${leadId}/enroll`, { method: 'POST', body: JSON.stringify({ workflow_id: selected }) });
      onDone('Enrolled — the engine will start on the next tick', true);
    } catch (e) {
      onDone(e instanceof Error ? e.message : 'Enroll failed', false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Enroll in workflow" onClose={onClose}>
      {workflows.length === 0 ? (
        <p className="text-sm text-zinc-400">
          No active workflows.{' '}
          <Link href="/crm/workflows" className="underline underline-offset-2">
            Create one
          </Link>{' '}
          and activate it first.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <Field label="Workflow">
            <Select value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">Choose…</option>
              {workflows.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex justify-end gap-3">
            <GhostBtn onClick={onClose}>Cancel</GhostBtn>
            <PrimaryBtn onClick={enroll} disabled={!selected || busy}>
              {busy ? 'Enrolling…' : 'Enroll'}
            </PrimaryBtn>
          </div>
        </div>
      )}
    </Modal>
  );
}
