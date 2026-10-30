'use client';

/**
 * Money — what the Home sells, what has been paid, what is invoiced, and the
 * client projects in flight. Reads the /api/crm money routes (MONEY.md).
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  api,
  EmptyState,
  Field,
  GhostBtn,
  Loading,
  Modal,
  PageHeader,
  PrimaryBtn,
  Select,
  StatusDot,
  TextInput,
  timeAgo,
  useToast,
} from '@/components/crm/kit';
import { DEFAULT_CURRENCY, formatMinor, normalizeCurrency, parseMajorToMinor } from '@/lib/money/money';
import { ENGAGEMENT_STAGES } from '@/lib/money/records';

type Product = {
  id: string;
  slug: string;
  name: string;
  kind: 'one_time' | 'subscription' | 'deposit' | 'invoice_item';
  amount_minor: number;
  currency: string;
  interval: 'month' | 'year' | null;
  active: boolean;
};

type Order = {
  id: string;
  email: string | null;
  lead_id: string | null;
  status: string;
  total_minor: number;
  currency: string;
  paid_at: string | null;
  created_at: string;
};

type Invoice = {
  id: string;
  number: string;
  lead_id: string | null;
  status: string;
  total_minor: number;
  currency: string;
  due_at: string | null;
  hosted_url: string | null;
  created_at: string;
};

type Engagement = {
  id: string;
  name: string;
  lead_id: string | null;
  stage: string;
  status: string;
  value_minor: number;
  currency: string;
  due_at: string | null;
  deliverables: { total: number; done: number };
};

const KIND_LABELS: Record<Product['kind'], string> = {
  one_time: 'One-off',
  subscription: 'Subscription',
  deposit: 'Deposit',
  invoice_item: 'Invoice item',
};

const MONEY_DOTS: Record<string, string> = {
  pending: 'bg-yellow-500',
  trial: 'bg-sky-400',
  paid: 'bg-green-500',
  refunded: 'bg-violet-400',
  void: 'bg-zinc-600',
  draft: 'bg-zinc-500',
  sent: 'bg-blue-400',
  active: 'bg-green-500',
  paused: 'bg-yellow-500',
  won: 'bg-emerald-400',
  lost: 'bg-zinc-600',
};

function price(p: Product): string {
  return `${formatMinor(p.amount_minor, p.currency)}${p.interval ? ` / ${p.interval}` : ''}`;
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-[13px] font-semibold text-white mb-3">
        {title}
        {count !== undefined && <span className="ml-2 font-medium text-minimal-muted">{count}</span>}
      </h2>
      {children}
    </section>
  );
}

function Rows({ children }: { children: ReactNode }) {
  return <div className="border border-minimal-border rounded-lg divide-y divide-minimal-border">{children}</div>;
}

async function fetchMoney() {
  const [p, o, i, e] = await Promise.all([
    api<{ products: Product[]; home_currency?: string }>('/api/crm/products'),
    api<{ orders: Order[] }>('/api/crm/orders?limit=20'),
    api<{ invoices: Invoice[] }>('/api/crm/invoices?limit=20'),
    api<{ engagements: Engagement[] }>('/api/crm/engagements?limit=50'),
  ]);
  return {
    products: p.products,
    homeCurrency: normalizeCurrency(p.home_currency) || DEFAULT_CURRENCY,
    orders: o.orders,
    invoices: i.invoices,
    engagements: e.engagements,
  };
}

export default function MoneyPage() {
  const { show, node: toastNode } = useToast();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [adding, setAdding] = useState(false);
  const [homeCurrency, setHomeCurrency] = useState(DEFAULT_CURRENCY);

  const load = useCallback(
    () =>
      fetchMoney().then(
        (m) => {
          setProducts(m.products);
          setHomeCurrency(m.homeCurrency);
          setOrders(m.orders);
          setInvoices(m.invoices);
          setEngagements(m.engagements);
        },
        (err) => {
          show(err instanceof Error ? err.message : 'Failed to load', 'err');
          setProducts([]);
        }
      ),
    [show]
  );

  useEffect(() => {
    load();
  }, [load]);

  const toggleProduct = async (p: Product) => {
    try {
      await api('/api/crm/products', { method: 'PATCH', body: JSON.stringify({ id: p.id, active: !p.active }) });
      show(p.active ? `${p.name} hidden from your site` : `${p.name} is on sale`);
      load();
    } catch (e) {
      show(e instanceof Error ? e.message : 'Update failed', 'err');
    }
  };

  const moveStage = async (e: Engagement, stage: string) => {
    try {
      await api('/api/crm/engagements', { method: 'PATCH', body: JSON.stringify({ id: e.id, stage }) });
      show(`${e.name}: ${stage}`);
      load();
    } catch (err) {
      show(err instanceof Error ? err.message : 'Update failed', 'err');
    }
  };

  const paidTotals = orders
    .filter((o) => o.status === 'paid')
    .reduce<Record<string, number>>((acc, o) => ({ ...acc, [o.currency]: (acc[o.currency] || 0) + o.total_minor }), {});

  return (
    <div className="flex flex-col h-full">
      {toastNode}
      <PageHeader title="Money">
        <PrimaryBtn onClick={() => setAdding(true)}>New product</PrimaryBtn>
      </PageHeader>

      <div className="flex-1 overflow-y-auto px-12 pb-12">
        {products === null ? (
          <Loading />
        ) : (
          <>
            {Object.keys(paidTotals).length > 0 && (
              <p className="text-[13px] text-minimal-muted mb-8">
                Paid in your last {orders.length} orders:{' '}
                <span className="text-white font-medium">
                  {Object.entries(paidTotals)
                    .map(([c, v]) => formatMinor(v, c))
                    .join(' · ')}
                </span>
              </p>
            )}

            <Section title="Products" count={products.length}>
              {products.length === 0 ? (
                <EmptyState
                  title="Nothing for sale yet"
                  hint="Add a product and your site can show it with a buy button. Payments land here once Stripe is connected (see MONEY.md)."
                />
              ) : (
                <Rows>
                  {products.map((p) => (
                    <div key={p.id} className="flex items-center gap-6 px-6 py-3.5 hover:bg-minimal-row transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] text-white truncate">{p.name}</p>
                        <p className="text-xs text-zinc-600 mt-0.5 truncate">
                          {KIND_LABELS[p.kind]} · {p.slug}
                        </p>
                      </div>
                      <p className="text-[14px] text-zinc-300 shrink-0 w-36 text-right">{price(p)}</p>
                      <div className="shrink-0 w-28 text-right">
                        <GhostBtn onClick={() => toggleProduct(p)} title={p.active ? 'Hide from your site' : 'Put on sale'}>
                          {p.active ? 'On sale' : 'Hidden'}
                        </GhostBtn>
                      </div>
                    </div>
                  ))}
                </Rows>
              )}
            </Section>

            <Section title="Engagements" count={engagements.length}>
              {engagements.length === 0 ? (
                <EmptyState
                  title="No client projects yet"
                  hint="Win a deal in the pipeline and its engagement opens here at the brief stage."
                />
              ) : (
                <Rows>
                  {engagements.map((e) => (
                    <div key={e.id} className="flex items-center gap-6 px-6 py-3.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] text-white truncate">
                          {e.lead_id ? (
                            <Link href={`/crm/leads/${e.lead_id}`} className="hover:underline">
                              {e.name}
                            </Link>
                          ) : (
                            e.name
                          )}
                        </p>
                        <p className="text-xs text-zinc-600 mt-0.5">
                          {formatMinor(e.value_minor, e.currency)} · {e.deliverables.done}/{e.deliverables.total} deliverables
                          {e.due_at ? ` · due ${new Date(e.due_at).toLocaleDateString()}` : ''}
                        </p>
                      </div>
                      <StatusDot status={e.status} map={MONEY_DOTS} />
                      <div className="w-36 shrink-0">
                        <Select value={e.stage} onChange={(ev) => moveStage(e, ev.target.value)}>
                          {ENGAGEMENT_STAGES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </Select>
                      </div>
                    </div>
                  ))}
                </Rows>
              )}
            </Section>

            <Section title="Recent orders" count={orders.length}>
              {orders.length === 0 ? (
                <EmptyState title="No orders yet" />
              ) : (
                <Rows>
                  {orders.map((o) => (
                    <div key={o.id} className="flex items-center gap-6 px-6 py-3">
                      <p className="flex-1 min-w-0 text-[14px] text-zinc-300 truncate">
                        {o.lead_id ? (
                          <Link href={`/crm/leads/${o.lead_id}`} className="hover:underline">
                            {o.email || 'Customer'}
                          </Link>
                        ) : (
                          o.email || 'Awaiting checkout'
                        )}
                      </p>
                      <StatusDot status={o.status} map={MONEY_DOTS} />
                      <p className="w-28 text-right text-[14px] text-white shrink-0">
                        {formatMinor(o.total_minor, o.currency, { exact: true })}
                      </p>
                      <p className="w-24 text-right text-xs text-zinc-600 shrink-0">{timeAgo(o.paid_at || o.created_at)}</p>
                    </div>
                  ))}
                </Rows>
              )}
            </Section>

            <Section title="Invoices" count={invoices.length}>
              {invoices.length === 0 ? (
                <EmptyState title="No invoices yet" hint="Invoices are raised through the API (POST /api/crm/invoices) or by your agent." />
              ) : (
                <Rows>
                  {invoices.map((inv) => (
                    <div key={inv.id} className="flex items-center gap-6 px-6 py-3">
                      <p className="flex-1 min-w-0 text-[14px] text-zinc-300 truncate">
                        {inv.hosted_url ? (
                          <a href={inv.hosted_url} target="_blank" rel="noreferrer" className="hover:underline">
                            {inv.number}
                          </a>
                        ) : (
                          inv.number
                        )}
                        {inv.due_at && <span className="text-xs text-zinc-600 ml-2">due {new Date(inv.due_at).toLocaleDateString()}</span>}
                      </p>
                      <StatusDot status={inv.status} map={MONEY_DOTS} />
                      <p className="w-28 text-right text-[14px] text-white shrink-0">
                        {formatMinor(inv.total_minor, inv.currency, { exact: true })}
                      </p>
                      <p className="w-24 text-right text-xs text-zinc-600 shrink-0">{timeAgo(inv.created_at)}</p>
                    </div>
                  ))}
                </Rows>
              )}
            </Section>
          </>
        )}
      </div>

      {adding && (
        <NewProductModal
          homeCurrency={homeCurrency}
          onClose={() => setAdding(false)}
          onDone={(name) => {
            setAdding(false);
            show(`${name} added`);
            load();
          }}
          onError={(m) => show(m, 'err')}
        />
      )}
    </div>
  );
}

function NewProductModal({
  homeCurrency,
  onClose,
  onDone,
  onError,
}: {
  homeCurrency: string;
  onClose: () => void;
  onDone: (name: string) => void;
  onError: (m: string) => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Product['kind']>('one_time');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('');
  const [interval, setBillingInterval] = useState<'month' | 'year'>('month');
  const [saving, setSaving] = useState(false);

  // Blank takes the Home's currency (backend_settings.money_currency).
  const code = currency.trim() ? normalizeCurrency(currency) : homeCurrency;
  const minor = code ? parseMajorToMinor(amount, code) : null;

  const save = async () => {
    if (!code || minor === null) return;
    setSaving(true);
    try {
      await api('/api/crm/products', {
        method: 'POST',
        body: JSON.stringify({
          name,
          kind,
          amount_minor: minor,
          currency: currency.trim() ? code : undefined,
          interval: kind === 'subscription' ? interval : null,
        }),
      });
      onDone(name);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Save failed');
      setSaving(false);
    }
  };

  return (
    <Modal title="New product" onClose={onClose} subtitle="Priced in your own Stripe account at checkout.">
      <div className="flex flex-col gap-4">
        <Field label="Name">
          <TextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Brand strategy session" />
        </Field>
        <Field label="Kind">
          <Select value={kind} onChange={(e) => setKind(e.target.value as Product['kind'])}>
            {(Object.keys(KIND_LABELS) as Product['kind'][]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Price">
            <TextInput value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="49.00" inputMode="decimal" />
          </Field>
          <Field label="Currency">
            <TextInput value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={3} placeholder={homeCurrency} />
          </Field>
          {kind === 'subscription' && (
            <Field label="Every">
              <Select value={interval} onChange={(e) => setBillingInterval(e.target.value as 'month' | 'year')}>
                <option value="month">month</option>
                <option value="year">year</option>
              </Select>
            </Field>
          )}
        </div>
        {code && minor !== null && (
          <p className="text-xs text-minimal-muted">
            Buyers see {formatMinor(minor, code)}
            {kind === 'subscription' ? ` / ${interval}` : ''}
          </p>
        )}
        <div className="flex justify-end gap-3 mt-2">
          <GhostBtn onClick={onClose}>Cancel</GhostBtn>
          <PrimaryBtn onClick={save} disabled={saving || !name.trim() || !code || minor === null}>
            {saving ? 'Saving…' : 'Add product'}
          </PrimaryBtn>
        </div>
      </div>
    </Modal>
  );
}
