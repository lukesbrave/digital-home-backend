'use client';

import Link from 'next/link';
import OptionalModules from '@/components/crm/optional-modules';
import { useCallback, useEffect, useState } from 'react';
import {
  api,
  Field,
  GhostBtn,
  Loading,
  PageHeader,
  PrimaryBtn,
  Select,
  TagChip,
  TextInput,
  useToast,
} from '@/components/crm/kit';

type Sender = { from_name: string; from_email: string; reply_to?: string; address?: string };
type SendWindow = { enabled: boolean; start_hour: number; end_hour: number; timezone: string; days: number[] };
type FieldDef = { id: string; key: string; label: string; field_type: string; options: string[]; sort_order: number };
type Tag = { id: string | null; name: string; color: string | null; count: number };
type Stage = { id: string; name: string; position: number };
type Pipeline = { id: string; name: string; is_default: boolean; stages: Stage[] };

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function CrmSettingsPage() {
  const { show, node: toastNode } = useToast();
  const [loaded, setLoaded] = useState(false);
  const [sender, setSender] = useState<Sender>({ from_name: '', from_email: '' });
  const [safeMode, setSafeMode] = useState(true);
  const [sendWindow, setSendWindow] = useState<SendWindow>({
    enabled: false,
    start_hour: 8,
    end_hour: 18,
    timezone: 'UTC',
    days: [1, 2, 3, 4, 5],
  });
  const [captureKey, setCaptureKey] = useState<string>('');
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);

  const load = useCallback(async () => {
    try {
      const [settingsRes, fieldsRes, tagsRes, pipeRes] = await Promise.all([
        api<{ settings: Record<string, unknown> }>('/api/settings'),
        api<{ fields: FieldDef[] }>('/api/crm/fields'),
        api<{ tags: Tag[] }>('/api/crm/tags'),
        api<{ pipelines: Pipeline[] }>('/api/crm/pipelines'),
      ]);
      const s = settingsRes.settings;
      if (s.crm_sender && typeof s.crm_sender === 'object') {
        const base: Sender = { from_name: '', from_email: '' };
        setSender(Object.assign(base, s.crm_sender as Partial<Sender>));
      }
      setSafeMode(s.crm_safe_mode !== false);
      if (s.crm_send_window && typeof s.crm_send_window === 'object')
        setSendWindow((w) => ({ ...w, ...(s.crm_send_window as SendWindow) }));
      if (typeof s.crm_capture_key === 'string') setCaptureKey(s.crm_capture_key);
      setFields(fieldsRes.fields);
      setTags(tagsRes.tags);
      setPipeline(pipeRes.pipelines.find((p) => p.is_default) || pipeRes.pipelines[0] || null);
      setLoaded(true);
    } catch (e) {
      show(e instanceof Error ? e.message : 'Failed to load settings', 'err');
    }
  }, [show]);

  useEffect(() => {
    load();
  }, [load]);

  const saveSetting = async (key: string, value: unknown, okMsg = 'Saved') => {
    try {
      await api('/api/settings', { method: 'POST', body: JSON.stringify({ key, value }) });
      show(okMsg);
    } catch (e) {
      show(e instanceof Error ? e.message : 'Save failed', 'err');
    }
  };

  if (!loaded) {
    return (
      <div className="flex flex-col h-full">
        <OptionalModules/>
      <Link className="underline block mb-4" href="/crm/settings/agents">Manage agent access</Link>
      <PageHeader title="CRM · Setup" />
        <Loading />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {toastNode}
      <PageHeader title="CRM · Setup" />
      <div className="flex-1 overflow-y-auto px-12 pb-16">
        <div className="grid lg:grid-cols-2 gap-10 max-w-6xl">
          {/* Sending */}
          <section className="border border-minimal-border rounded-lg p-6 flex flex-col gap-4">
            <h2 className="text-[13px] font-semibold text-zinc-300">Email sending</h2>

            <div
              className={`px-4 py-3 border rounded-lg flex items-center justify-between ${
                safeMode ? 'border-yellow-500/20 bg-yellow-500/5' : 'border-green-500/20 bg-green-500/5'
              }`}
            >
              <div>
                <p className={`text-xs ${safeMode ? 'text-yellow-500' : 'text-green-500'}`}>
                  {safeMode ? 'Safe mode — emails are simulated' : 'Live — emails really send'}
                </p>
                <p className="text-xs text-zinc-500 mt-1">
                  {safeMode
                    ? 'Workflows run fully but log emails instead of sending. Perfect while you test.'
                    : 'Requires RESEND_API_KEY on the worker + a verified sending domain in Resend.'}
                </p>
              </div>
              <GhostBtn
                onClick={() => {
                  const next = !safeMode;
                  setSafeMode(next);
                  saveSetting('crm_safe_mode', next, next ? 'Safe mode ON' : 'LIVE sending enabled');
                }}
              >
                {safeMode ? 'Go live' : 'Back to safe'}
              </GhostBtn>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="From name">
                <TextInput value={sender.from_name} onChange={(e) => setSender({ ...sender, from_name: e.target.value })} />
              </Field>
              <Field label="From email" hint="Domain must be verified in Resend">
                <TextInput value={sender.from_email} onChange={(e) => setSender({ ...sender, from_email: e.target.value })} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Reply-to">
                <TextInput value={sender.reply_to || ''} onChange={(e) => setSender({ ...sender, reply_to: e.target.value })} />
              </Field>
              <Field label="Physical address" hint="Shown in the footer (anti-spam law)">
                <TextInput value={sender.address || ''} onChange={(e) => setSender({ ...sender, address: e.target.value })} />
              </Field>
            </div>
            <div className="flex justify-end">
              <PrimaryBtn onClick={() => saveSetting('crm_sender', sender, 'Sender saved')}>Save sender</PrimaryBtn>
            </div>
          </section>

          {/* Send window */}
          <section className="border border-minimal-border rounded-lg p-6 flex flex-col gap-4">
            <h2 className="text-[13px] font-semibold text-zinc-300">Send window</h2>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={sendWindow.enabled}
                onChange={(e) => setSendWindow({ ...sendWindow, enabled: e.target.checked })}
              />
              <span className="text-[13px] text-zinc-400">
                Only send workflow emails during these hours (waits hold until the window opens)
              </span>
            </label>
            <div className="grid grid-cols-3 gap-3">
              <Field label="From (hour)">
                <TextInput
                  type="number"
                  min={0}
                  max={23}
                  value={String(sendWindow.start_hour)}
                  onChange={(e) => setSendWindow({ ...sendWindow, start_hour: Number(e.target.value) || 0 })}
                />
              </Field>
              <Field label="To (hour)">
                <TextInput
                  type="number"
                  min={1}
                  max={24}
                  value={String(sendWindow.end_hour)}
                  onChange={(e) => setSendWindow({ ...sendWindow, end_hour: Number(e.target.value) || 0 })}
                />
              </Field>
              <Field label="Timezone">
                <TextInput
                  value={sendWindow.timezone}
                  onChange={(e) => setSendWindow({ ...sendWindow, timezone: e.target.value })}
                />
              </Field>
            </div>
            <div className="flex gap-2">
              {DAY_LABELS.map((d, i) => (
                <button
                  key={d}
                  onClick={() =>
                    setSendWindow({
                      ...sendWindow,
                      days: sendWindow.days.includes(i)
                        ? sendWindow.days.filter((x) => x !== i)
                        : [...sendWindow.days, i].sort(),
                    })
                  }
                  className={`text-xs px-3 py-1.5 border rounded-lg transition-colors ${
                    sendWindow.days.includes(i)
                      ? 'border-zinc-400 text-white'
                      : 'border-minimal-border text-zinc-600 hover:text-zinc-400'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
            <div className="flex justify-end">
              <PrimaryBtn onClick={() => saveSetting('crm_send_window', sendWindow, 'Send window saved')}>
                Save window
              </PrimaryBtn>
            </div>
          </section>

          {/* Capture key */}
          <section className="border border-minimal-border rounded-lg p-6 flex flex-col gap-3">
            <h2 className="text-[13px] font-semibold text-zinc-300">Lead capture key</h2>
            <p className="text-[13px] text-zinc-500 leading-relaxed">
              External senders (site forms proxy, GHL webhooks, Zapier) authenticate to{' '}
              <code className="text-zinc-300">POST /api/crm/capture</code> with the{' '}
              <code className="text-zinc-300">x-capture-key</code> header:
            </p>
            {captureKey ? (
              <div className="flex items-center gap-3">
                <code className="flex-1 text-[13px] text-zinc-300 bg-minimal-row border border-minimal-border rounded-lg px-3 py-2 break-all">
                  {captureKey}
                </code>
                <GhostBtn
                  onClick={() => {
                    navigator.clipboard.writeText(captureKey);
                    show('Copied');
                  }}
                >
                  Copy
                </GhostBtn>
              </div>
            ) : (
              <GhostBtn
                onClick={() => {
                  const key = Array.from(crypto.getRandomValues(new Uint8Array(24)))
                    .map((b) => b.toString(16).padStart(2, '0'))
                    .join('');
                  setCaptureKey(key);
                  saveSetting('crm_capture_key', key, 'Capture key generated');
                }}
              >
                Generate key
              </GhostBtn>
            )}
          </section>

          {/* Pipeline stages */}
          <section className="border border-minimal-border rounded-lg p-6 flex flex-col gap-4">
            <h2 className="text-[13px] font-semibold text-zinc-300">
              Pipeline stages{pipeline ? ` — ${pipeline.name}` : ''}
            </h2>
            {!pipeline ? (
              <p className="text-[13px] text-zinc-600">No pipeline yet — run the CRM migration first.</p>
            ) : (
              <StagesEditor pipeline={pipeline} onChanged={load} onNotify={show} />
            )}
          </section>

          {/* Custom fields */}
          <section className="border border-minimal-border rounded-lg p-6 flex flex-col gap-4">
            <h2 className="text-[13px] font-semibold text-zinc-300">Custom fields</h2>
            <FieldsEditor fields={fields} onChanged={load} onNotify={show} />
          </section>

          {/* Tags */}
          <section className="border border-minimal-border rounded-lg p-6 flex flex-col gap-4">
            <h2 className="text-[13px] font-semibold text-zinc-300">Tags in use</h2>
            <div className="flex flex-wrap gap-2">
              {tags.length === 0 && <p className="text-[13px] text-zinc-600">No tags yet — they appear as you use them.</p>}
              {tags.map((t) => (
                <span key={t.name} className="inline-flex items-center gap-1.5">
                  <TagChip tag={`${t.name} · ${t.count}`} />
                </span>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function StagesEditor({
  pipeline,
  onChanged,
  onNotify,
}: {
  pipeline: Pipeline;
  onChanged: () => void;
  onNotify: (m: string, kind?: 'ok' | 'err') => void;
}) {
  const [newStage, setNewStage] = useState('');

  const rename = async (stage: Stage, name: string) => {
    if (!name.trim() || name === stage.name) return;
    try {
      await api('/api/crm/pipelines/stages', { method: 'PATCH', body: JSON.stringify({ id: stage.id, name }) });
      onChanged();
    } catch (e) {
      onNotify(e instanceof Error ? e.message : 'Rename failed', 'err');
    }
  };

  const move = async (index: number, dir: -1 | 1) => {
    const stages = [...pipeline.stages];
    const j = index + dir;
    if (j < 0 || j >= stages.length) return;
    try {
      await Promise.all([
        api('/api/crm/pipelines/stages', { method: 'PATCH', body: JSON.stringify({ id: stages[index].id, position: j }) }),
        api('/api/crm/pipelines/stages', { method: 'PATCH', body: JSON.stringify({ id: stages[j].id, position: index }) }),
      ]);
      onChanged();
    } catch (e) {
      onNotify(e instanceof Error ? e.message : 'Reorder failed', 'err');
    }
  };

  const remove = async (stage: Stage) => {
    try {
      await api(`/api/crm/pipelines/stages?id=${stage.id}`, { method: 'DELETE' });
      onChanged();
    } catch (e) {
      onNotify(e instanceof Error ? e.message : 'Delete failed', 'err');
    }
  };

  const add = async () => {
    if (!newStage.trim()) return;
    try {
      await api('/api/crm/pipelines/stages', {
        method: 'POST',
        body: JSON.stringify({ pipeline_id: pipeline.id, name: newStage.trim() }),
      });
      setNewStage('');
      onChanged();
    } catch (e) {
      onNotify(e instanceof Error ? e.message : 'Add failed', 'err');
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {pipeline.stages.map((s, i) => (
        <div key={s.id} className="flex items-center gap-2">
          <TextInput defaultValue={s.name} onBlur={(e) => rename(s, e.target.value)} className="flex-1" />
          <button onClick={() => move(i, -1)} disabled={i === 0} className="text-zinc-600 hover:text-white disabled:opacity-20 px-1">
            ↑
          </button>
          <button
            onClick={() => move(i, 1)}
            disabled={i === pipeline.stages.length - 1}
            className="text-zinc-600 hover:text-white disabled:opacity-20 px-1"
          >
            ↓
          </button>
          <button onClick={() => remove(s)} className="text-zinc-600 hover:text-red-400 px-1">
            ×
          </button>
        </div>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
        className="flex items-center gap-2 mt-1"
      >
        <TextInput value={newStage} onChange={(e) => setNewStage(e.target.value)} placeholder="New stage name" className="flex-1" />
        <GhostBtn onClick={add}>Add</GhostBtn>
      </form>
    </div>
  );
}

function FieldsEditor({
  fields,
  onChanged,
  onNotify,
}: {
  fields: FieldDef[];
  onChanged: () => void;
  onNotify: (m: string, kind?: 'ok' | 'err') => void;
}) {
  const [label, setLabel] = useState('');
  const [type, setType] = useState('text');
  const [options, setOptions] = useState('');

  const add = async () => {
    if (!label.trim()) return;
    try {
      await api('/api/crm/fields', {
        method: 'POST',
        body: JSON.stringify({
          label: label.trim(),
          field_type: type,
          options: type === 'select' || type === 'multiselect' ? options.split(',').map((o) => o.trim()).filter(Boolean) : [],
        }),
      });
      setLabel('');
      setOptions('');
      onChanged();
      onNotify('Field added');
    } catch (e) {
      onNotify(e instanceof Error ? e.message : 'Add failed', 'err');
    }
  };

  const remove = async (f: FieldDef) => {
    try {
      await api(`/api/crm/fields?id=${f.id}`, { method: 'DELETE' });
      onChanged();
    } catch (e) {
      onNotify(e instanceof Error ? e.message : 'Delete failed', 'err');
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {fields.map((f) => (
        <div key={f.id} className="flex items-center justify-between gap-3 text-sm">
          <span className="text-zinc-300">
            {f.label} <code className="text-zinc-600 text-xs">custom.{f.key}</code>{' '}
            <span className="text-zinc-600 text-xs">({f.field_type})</span>
          </span>
          <button onClick={() => remove(f)} className="text-zinc-600 hover:text-red-400">
            ×
          </button>
        </div>
      ))}
      <div className="grid grid-cols-2 gap-3 mt-1">
        <Field label="New field label">
          <TextInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Business type" />
        </Field>
        <Field label="Type">
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            {['text', 'number', 'date', 'select', 'boolean', 'url'].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {type === 'select' && (
        <Field label="Options (comma separated)">
          <TextInput value={options} onChange={(e) => setOptions(e.target.value)} placeholder="Solo, Agency, SaaS" />
        </Field>
      )}
      <div className="flex justify-end">
        <GhostBtn onClick={add} disabled={!label.trim()}>
          Add field
        </GhostBtn>
      </div>
    </div>
  );
}
