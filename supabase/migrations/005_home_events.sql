-- Refuse schema-name collisions. The migration runner skips already-recorded files.
DO $$ BEGIN
  if to_regclass('public.home_events') is not null then raise exception 'Starter 3.0: existing home_events table requires a reviewed adoption; no automatic replacement'; end if;
END $$;

-- Home events — one stream of everything anyone does in the Home, each row a
-- receipt (see EVENTS.md).
--
-- Before this, activity lived in four places (lead_activities, funnel_events,
-- agent_logs, agent_actions) and no agent could ask "what changed since I last
-- looked". Every row here says who did it (actor_type + actor), what they did
-- (action, verb.noun from the allow-list in src/lib/events/shape.ts), to what
-- (subject_type + subject_id, lead_id when a lead is involved), and the proof
-- (evidence: ids from Buzz, Resend, a webhook or a request). Receipts carry
-- ids and fixed enums only, never names, emails, subjects or free text.
--
-- `seq` is the feed cursor: an identity column, so it only ever grows. It is
-- assigned at insert but visible at commit, so a lower seq can become visible
-- after a higher one. The feed therefore serves only rows older than a few
-- seconds (FEED_SETTLE_MS in src/lib/events/shape.ts); with that lag a poller
-- that remembers the last seq it saw does not miss rows from ordinary
-- single-statement writes. Rows are append-only receipts; the one exception
-- is scrub_home_events_for_lead, the erasure path when a lead is deleted.

create table if not exists public.home_events (
  id           uuid primary key default gen_random_uuid(),
  seq          bigint generated always as identity,
  occurred_at  timestamptz not null default now(),
  actor_type   text not null check (actor_type in ('human', 'agent', 'system', 'webhook')),
  actor        text not null,                 -- a user id, an agent key name, 'cron', or the webhook source
  action       text not null check (action ~ '^[a-z_]+\.[a-z_]+$'),  -- e.g. lead.captured
  subject_type text,                          -- e.g. lead, opportunity, email, article, approval, agent_key
  subject_id   text,
  lead_id      uuid,                          -- no foreign key: a receipt outlives a deleted lead
  payload      jsonb not null default '{}'::jsonb,
  evidence     jsonb not null default '{}'::jsonb  -- e.g. {buzz_event_id, email_id, webhook_id, request_id}
);

create unique index if not exists home_events_seq_idx on public.home_events (seq);
create index if not exists home_events_lead_seq_idx on public.home_events (lead_id, seq) where lead_id is not null;
create index if not exists home_events_action_seq_idx on public.home_events (action, seq);
create index if not exists home_events_occurred_at_idx on public.home_events (occurred_at);

comment on table public.home_events is
  'Append-only receipts of everything done in the Home. Read through GET /api/events with seq as the cursor.';
comment on column public.home_events.seq is
  'Feed cursor. Increasing in insert order; visible at commit, so the feed holds back the newest few seconds.';
comment on column public.home_events.payload is
  'Ids, slugs, numbers, booleans and fixed enums only. Never names, emails, subjects, titles or free text.';
comment on column public.home_events.evidence is
  'Provenance ids only (agent_action_id, buzz_event_id, email_id, send_id, skool_user_id, stripe_session_id, ...). Never secrets.';

-- Service-role only, same posture as agent_keys: the Home writes with the
-- service key and the feed route reads with it; nothing reads this from a browser.
alter table public.home_events enable row level security;
revoke all on public.home_events from anon, authenticated;
grant all on public.home_events to service_role;

-- Counts by action since a moment, for GET /api/events/stats. PostgREST has no
-- GROUP BY, so the route calls this instead of pulling every row.
create or replace function public.home_event_counts(since timestamptz)
returns table (action text, count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select e.action, count(*)::bigint
  from public.home_events e
  where e.occurred_at >= since
  group by e.action
  order by count(*) desc, e.action;
$$;

revoke all on function public.home_event_counts(timestamptz) from public, anon, authenticated;
grant execute on function public.home_event_counts(timestamptz) to service_role;

-- An opaque id or null: the same rule as ID_RE in src/lib/events/shape.ts.
create or replace function public.home_event_id_or_null(value text)
returns text
language sql
immutable
set search_path = public
as $$
  select case when value ~ '^[A-Za-z0-9_-]{1,255}$' then value end;
$$;

revoke all on function public.home_event_id_or_null(text) from public, anon, authenticated;

-- Erasure: when a lead is deleted (DELETE /api/crm/leads/[id]), its receipts
-- go too: rows carrying its lead_id and rows whose subject is the lead.
-- Returns how many rows were deleted.
create or replace function public.scrub_home_events_for_lead(p_lead_id uuid)
returns bigint
language sql
volatile
security invoker
set search_path = public
as $$
  with gone as (
    delete from public.home_events e
    where e.lead_id = p_lead_id
       or (e.subject_type = 'lead' and e.subject_id = p_lead_id::text)
    returning 1
  )
  select count(*)::bigint from gone;
$$;

revoke all on function public.scrub_home_events_for_lead(uuid) from public, anon, authenticated;
grant execute on function public.scrub_home_events_for_lead(uuid) to service_role;
