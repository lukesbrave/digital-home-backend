'use client';

/**
 * Small UI kit for the CRM pages. Type system: sentence case throughout,
 * semibold headings (lg page titles, 13px section headers), 14px body,
 * 12px meta. Colors ride the themed variables in globals.css, so every
 * component works in both light and dark mode.
 */
import { useCallback, useState, type ReactNode } from 'react';

// ── fetch helper ─────────────────────────────────────────────────────────────

export async function api<T = Record<string, unknown>>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

// ── toasts ───────────────────────────────────────────────────────────────────

let toastSeq = 0;

/**
 * Toasts live bottom-right on a solid surface so they never sit over page
 * controls (the header actions are top-right) and never show content through
 * themselves. They stack (newest at the bottom), auto-dismiss — errors hang
 * around longer — and a click dismisses early.
 */
export function useToast() {
  const [toasts, setToasts] = useState<Array<{ id: number; text: string; kind: 'ok' | 'err' }>>([]);
  const show = useCallback((text: string, kind: 'ok' | 'err' = 'ok') => {
    const id = ++toastSeq;
    setToasts((prev) => [...prev.slice(-2), { id, text, kind }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, kind === 'err' ? 6000 : 3200);
  }, []);
  const node = toasts.length ? (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col items-end gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          title="Dismiss"
          onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
          className="toast-enter-up flex items-start gap-2.5 pl-4 pr-5 py-3 rounded-lg border border-minimal-border bg-minimal-bg shadow-xl text-[13px] font-medium text-left max-w-sm cursor-pointer"
        >
          <span
            className={`mt-[5px] w-2 h-2 rounded-full shrink-0 ${
              t.kind === 'ok' ? 'bg-green-500' : 'bg-red-500'
            }`}
          />
          <span className={t.kind === 'ok' ? 'text-green-500' : 'text-red-400'}>{t.text}</span>
        </button>
      ))}
    </div>
  ) : null;
  return { show, node };
}

// ── layout bits ──────────────────────────────────────────────────────────────

export function PageHeader({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <header className="h-20 px-12 flex items-center justify-between shrink-0">
      <h1 className="text-lg font-semibold text-white">{title}</h1>
      <div className="flex items-center gap-4">{children}</div>
    </header>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center fade-in">
      <p className="text-sm font-medium text-zinc-400">{title}</p>
      {hint && <p className="text-[13px] text-zinc-600 mt-2 max-w-sm leading-relaxed">{hint}</p>}
    </div>
  );
}

export function Loading() {
  return (
    <div className="flex items-center justify-center py-24">
      <span className="text-[13px] font-medium text-minimal-muted animate-pulse">Loading…</span>
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />
      <div
        className={`relative w-full ${wide ? 'max-w-2xl' : 'max-w-md'} border border-minimal-border bg-minimal-bg rounded-xl p-8 max-h-[85vh] overflow-y-auto fade-in`}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-base font-semibold text-white">{title}</h2>
          <button onClick={onClose} className="text-minimal-muted hover:text-white text-lg leading-none">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── form controls ────────────────────────────────────────────────────────────

const inputCls =
  'w-full bg-minimal-row border border-minimal-border rounded-lg px-3 py-2 text-[14px] text-white placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none transition-colors';

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="block text-[13px] font-medium text-zinc-300 mb-1.5">
        {label}
      </span>
      {children}
      {hint && <span className="block text-xs text-zinc-600 mt-1">{hint}</span>}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputCls} ${props.className || ''}`} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputCls} leading-relaxed ${props.className || ''}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={`${inputCls} appearance-none ${props.className || ''}`}>
      {props.children}
    </select>
  );
}

export function PrimaryBtn({
  children,
  onClick,
  disabled,
  type,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type || 'button'}
      onClick={onClick}
      disabled={disabled}
      className="text-[13px] font-semibold bg-white text-black px-4 py-2 rounded-lg disabled:opacity-40 hover:bg-zinc-200 transition-colors"
    >
      {children}
    </button>
  );
}

export function GhostBtn({
  children,
  onClick,
  disabled,
  danger,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`text-[13px] font-medium px-3.5 py-2 border rounded-lg transition-colors disabled:opacity-40 ${
        danger
          ? 'border-red-500/30 text-red-400 hover:bg-red-500/10'
          : 'border-minimal-border text-minimal-muted hover:text-white hover:border-minimal-muted'
      }`}
    >
      {children}
    </button>
  );
}

// ── badges + formatting ──────────────────────────────────────────────────────

export const LEAD_STATUS_DOTS: Record<string, string> = {
  new: 'bg-blue-400',
  engaged: 'bg-yellow-500',
  qualified: 'bg-violet-400',
  converted: 'bg-green-500',
  lost: 'bg-zinc-600',
};

export function StatusDot({ status, map }: { status: string; map?: Record<string, string> }) {
  const color = (map || LEAD_STATUS_DOTS)[status] || 'bg-minimal-muted';
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`w-1.5 h-1.5 rounded-full ${color}`} />
      <span className="text-xs font-medium capitalize text-zinc-400">{status.replace(/_/g, ' ')}</span>
    </span>
  );
}

export function TagChip({ tag, onRemove }: { tag: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 border border-minimal-border rounded-full text-xs font-medium text-zinc-300 bg-minimal-row">
      {tag}
      {onRemove && (
        <button onClick={onRemove} className="text-zinc-600 hover:text-red-400 leading-none">
          ×
        </button>
      )}
    </span>
  );
}

export function leadName(lead: { first_name?: string | null; last_name?: string | null; email: string }): string {
  return [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.email;
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function fmtMoney(cents: number, currency = 'AUD'): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency, maximumFractionDigits: 0 }).format(
    (cents || 0) / 100
  );
}

export const ACTIVITY_ICONS: Record<string, string> = {
  created: '●',
  note: '✎',
  email_sent: '✉',
  email_received: '↩',
  email_opened: '◉',
  email_clicked: '↗',
  email_bounced: '⚠',
  form_submitted: '▤',
  tag_added: '#',
  tag_removed: '#',
  status_changed: '⇄',
  stage_changed: '⇢',
  enrolled: '▶',
  workflow_completed: '✓',
  workflow_failed: '✗',
  task_created: '☐',
  appointment_booked: '◷',
  field_updated: '✎',
  unsubscribed: '⊘',
  webhook: '⚡',
};
