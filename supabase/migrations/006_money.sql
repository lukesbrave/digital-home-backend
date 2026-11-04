-- Refuse schema-name collisions. The migration runner skips already-recorded files.
DO $$ BEGIN
  if to_regclass('public.products') is not null then raise exception 'Starter 3.0: existing products table requires a reviewed adoption; no automatic replacement'; end if;
  if to_regclass('public.orders') is not null then raise exception 'Starter 3.0: existing orders table requires a reviewed adoption; no automatic replacement'; end if;
  if to_regclass('public.order_items') is not null then raise exception 'Starter 3.0: existing order_items table requires a reviewed adoption; no automatic replacement'; end if;
  if to_regclass('public.engagements') is not null then raise exception 'Starter 3.0: existing engagements table requires a reviewed adoption; no automatic replacement'; end if;
  if to_regclass('public.engagement_deliverables') is not null then raise exception 'Starter 3.0: existing engagement_deliverables table requires a reviewed adoption; no automatic replacement'; end if;
  if to_regclass('public.invoices') is not null then raise exception 'Starter 3.0: existing invoices table requires a reviewed adoption; no automatic replacement'; end if;
  if to_regclass('public.invoice_items') is not null then raise exception 'Starter 3.0: existing invoice_items table requires a reviewed adoption; no automatic replacement'; end if;
  if to_regclass('public.payment_events') is not null then raise exception 'Starter 3.0: existing payment_events table requires a reviewed adoption; no automatic replacement'; end if;
  if to_regclass('public.payouts') is not null then raise exception 'Starter 3.0: existing payouts table requires a reviewed adoption; no automatic replacement'; end if;
END $$;

-- Money — products, orders, invoices, client engagements and payment events,
-- on the member's own Stripe account (see MONEY.md).
--
-- Additive only: new tables, nothing existing is altered. Amounts are integer
-- minor units (cents for AUD/USD, whole yen for JPY), currencies are ISO 4217
-- upper case. Stripe is the source of truth for what was charged; these
-- tables are the Home's record of it, kept current by POST /api/webhooks/stripe.
--
-- Service-role only, same posture as agent_keys: the
-- routes run with the service key; nothing reads these tables from a browser.
-- The public product list is served by GET /api/public/products, not by RLS.

-- ── products ────────────────────────────────────────────────────────────────

create table if not exists public.products (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique,
  name              text not null,
  description       text,
  kind              text not null check (kind in ('one_time', 'subscription', 'deposit', 'invoice_item')),
  amount_minor      integer not null check (amount_minor >= 0),
  currency          char(3) not null,
  "interval"        text check ("interval" in ('month', 'year')),
  active            boolean not null default true,
  stripe_product_id text,
  stripe_price_id   text,
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- A subscription bills on an interval; nothing else does.
  constraint products_interval_matches_kind check (
    (kind = 'subscription' and "interval" is not null) or (kind <> 'subscription' and "interval" is null)
  )
);

create index if not exists products_active_idx on public.products (active) where active;

-- ── orders ──────────────────────────────────────────────────────────────────

create table if not exists public.orders (
  id                         uuid primary key default gen_random_uuid(),
  lead_id                    uuid references public.leads(id) on delete set null,
  email                      text,
  -- trial: a subscription that started free; it becomes paid with its first real invoice.
  status                     text not null default 'pending' check (status in ('pending', 'trial', 'paid', 'refunded', 'void')),
  total_minor                integer not null default 0 check (total_minor >= 0),
  currency                   char(3) not null,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id   text,
  stripe_subscription_id     text,
  paid_at                    timestamptz,
  livemode                   boolean,                 -- Stripe live (true) or test (false) mode; null before Stripe knew of it
  metadata                   jsonb not null default '{}'::jsonb,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

create index if not exists orders_lead_idx on public.orders (lead_id);
create index if not exists orders_created_idx on public.orders (created_at desc);
-- One order per payment and per subscription, so a redelivered or racing
-- webhook can never record the same sale twice.
create unique index if not exists orders_payment_intent_idx on public.orders (stripe_payment_intent_id) where stripe_payment_intent_id is not null;
create unique index if not exists orders_subscription_idx on public.orders (stripe_subscription_id) where stripe_subscription_id is not null;

create table if not exists public.order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders(id) on delete cascade,
  product_id   uuid references public.products(id) on delete set null,
  quantity     integer not null default 1 check (quantity > 0),
  amount_minor integer not null check (amount_minor >= 0), -- per unit
  created_at   timestamptz not null default now()
);

create index if not exists order_items_order_idx on public.order_items (order_id);

-- ── engagements (a client project at a stage) ───────────────────────────────

create table if not exists public.engagements (
  id             uuid primary key default gen_random_uuid(),
  lead_id        uuid references public.leads(id) on delete set null,
  -- The won deal this engagement came from, if any. Unique so winning the
  -- same deal twice never opens a second project. No foreign key: the
  -- pipeline tables belong to the CRM migrations, which a Home may not carry.
  opportunity_id uuid unique,
  name           text not null,
  stage          text not null default 'brief'
                 check (stage in ('brief', 'research', 'copy', 'design', 'review', 'build', 'launch', 'care', 'closed')),
  status         text not null default 'active' check (status in ('active', 'paused', 'won', 'lost')),
  scope          text,
  value_minor    integer not null default 0 check (value_minor >= 0),
  currency       char(3) not null,
  started_at     timestamptz,
  due_at         timestamptz,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists engagements_lead_idx on public.engagements (lead_id);
create index if not exists engagements_status_idx on public.engagements (status, stage);

create table if not exists public.engagement_deliverables (
  id            uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  name          text not null,
  status        text not null default 'todo' check (status in ('todo', 'in_progress', 'review', 'done')),
  due_at        timestamptz,
  position      integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists engagement_deliverables_engagement_idx on public.engagement_deliverables (engagement_id, position);

-- ── invoices ────────────────────────────────────────────────────────────────

create table if not exists public.invoices (
  id                uuid primary key default gen_random_uuid(),
  number            text not null unique,
  lead_id           uuid references public.leads(id) on delete set null,
  engagement_id     uuid references public.engagements(id) on delete set null,
  status            text not null default 'draft' check (status in ('draft', 'sent', 'paid', 'void')),
  due_at            timestamptz,
  total_minor       integer not null default 0 check (total_minor >= 0),
  currency          char(3) not null,
  stripe_invoice_id text unique,
  hosted_url        text,
  pdf_url           text,
  paid_at           timestamptz,
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists invoices_lead_idx on public.invoices (lead_id);
create index if not exists invoices_engagement_idx on public.invoices (engagement_id);
create index if not exists invoices_created_idx on public.invoices (created_at desc);

create table if not exists public.invoice_items (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references public.invoices(id) on delete cascade,
  product_id   uuid references public.products(id) on delete set null,
  description  text not null,
  quantity     integer not null default 1 check (quantity > 0),
  amount_minor integer not null check (amount_minor >= 0), -- per unit
  created_at   timestamptz not null default now()
);

create index if not exists invoice_items_invoice_idx on public.invoice_items (invoice_id);

-- ── payment events (webhook idempotency + audit) ────────────────────────────

create table if not exists public.payment_events (
  id                uuid primary key default gen_random_uuid(),
  provider          text not null default 'stripe' check (provider in ('stripe')),
  provider_event_id text not null unique,     -- Stripe's evt_…; a replay hits this and is skipped
  type              text not null,
  livemode          boolean,
  payload           jsonb not null,
  received_at       timestamptz not null default now(),
  -- A delivery claims the row before applying it (claimed_at set where it was
  -- null or older than five minutes), so two concurrent deliveries of one
  -- event never both apply it. A failure releases the claim.
  claimed_at        timestamptz,
  processed_at      timestamptz,              -- null until applied; a failed event is retried on redelivery
  error             text,
  result            jsonb                     -- what applying it did (orders, lead, onboarding), for the owner to read
);

create index if not exists payment_events_received_idx on public.payment_events (received_at desc);

-- ── payouts (affiliate commissions later; same rails) ───────────────────────

create table if not exists public.payouts (
  id                 uuid primary key default gen_random_uuid(),
  lead_id            uuid references public.leads(id) on delete set null,
  amount_minor       integer not null check (amount_minor >= 0),
  currency           char(3) not null,
  reason             text,
  status             text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'void')),
  stripe_transfer_id text unique,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists payouts_lead_idx on public.payouts (lead_id);

-- ── updated_at ──────────────────────────────────────────────────────────────

drop trigger if exists products_updated_at on public.products;
create trigger products_updated_at before update on public.products
  for each row execute function public.update_updated_at();
drop trigger if exists orders_updated_at on public.orders;
create trigger orders_updated_at before update on public.orders
  for each row execute function public.update_updated_at();
drop trigger if exists engagements_updated_at on public.engagements;
create trigger engagements_updated_at before update on public.engagements
  for each row execute function public.update_updated_at();
drop trigger if exists engagement_deliverables_updated_at on public.engagement_deliverables;
create trigger engagement_deliverables_updated_at before update on public.engagement_deliverables
  for each row execute function public.update_updated_at();
drop trigger if exists invoices_updated_at on public.invoices;
create trigger invoices_updated_at before update on public.invoices
  for each row execute function public.update_updated_at();
drop trigger if exists payouts_updated_at on public.payouts;
create trigger payouts_updated_at before update on public.payouts
  for each row execute function public.update_updated_at();

-- ── RLS: service role only ──────────────────────────────────────────────────

alter table public.products                enable row level security;
alter table public.orders                  enable row level security;
alter table public.order_items             enable row level security;
alter table public.engagements             enable row level security;
alter table public.engagement_deliverables enable row level security;
alter table public.invoices                enable row level security;
alter table public.invoice_items           enable row level security;
alter table public.payment_events          enable row level security;
alter table public.payouts                 enable row level security;

revoke all on public.products, public.orders, public.order_items, public.engagements,
  public.engagement_deliverables, public.invoices, public.invoice_items,
  public.payment_events, public.payouts
  from anon, authenticated;
grant all on public.products, public.orders, public.order_items, public.engagements,
  public.engagement_deliverables, public.invoices, public.invoice_items,
  public.payment_events, public.payouts
  to service_role;

comment on table public.products is 'What the Home sells. Active products (except invoice_item) are listed by GET /api/public/products.';
comment on table public.orders is 'One checkout. Pending until checkout.session.completed marks it paid.';
comment on table public.engagements is 'A client project at a stage (brief → … → care → closed). Opened from a won deal or by hand.';
comment on table public.payment_events is 'Every Stripe webhook event, keyed by its id so a redelivery is never applied twice.';
comment on table public.payouts is 'Money out (affiliate commissions). Schema only for now; no route writes it yet.';
