-- Generic approvals and MCP audit only; no private agent runtime.
-- Plain CREATE deliberately refuses an existing table-name collision.
create table public.agent_runs (
 id uuid primary key default gen_random_uuid(), trigger text not null default 'chat' check(trigger in ('chat','tick','hermes')),
 status text not null default 'running' check(status in ('running','completed','failed')),
 summary text, report_md text, tool_calls jsonb not null default '[]', tokens_used integer, error text,
 created_at timestamptz not null default now(), completed_at timestamptz
);
create table public.agent_actions (
 id uuid primary key default gen_random_uuid(), run_id uuid references public.agent_runs(id),
 type text not null check(type in ('email','publish','workflow','other')), title text not null, summary text,
 payload jsonb not null default '{}', status text not null default 'proposed' check(status in ('proposed','approved','rejected','executed','failed')),
 result jsonb, created_at timestamptz not null default now(), decided_at timestamptz, executed_at timestamptz
);
create index agent_actions_status_time on public.agent_actions(status,created_at desc);
create unique index agent_actions_pending_article on public.agent_actions ((payload->>'keyword_key')) where status='proposed' and payload->>'kind'='article_topic';
create unique index agent_actions_pending_deal on public.agent_actions ((payload->>'opportunity_id')) where status='proposed' and payload->>'kind'='pipeline_move';
alter table public.agent_runs enable row level security;
alter table public.agent_actions enable row level security;
revoke all on public.agent_runs, public.agent_actions from anon, authenticated;
grant all on public.agent_runs, public.agent_actions to service_role;
