-- Unmodified public frontend migrations at 257dfe3, for isolated SQL tests only.

-- SOURCE: 001_visitors.sql
-- Migration 001: Visitors
-- Anonymous visitor tracking. No PII until email capture.
-- A visitor is created on first page load via middleware cookie.

create extension if not exists "uuid-ossp";

create table visitors (
  id uuid primary key default uuid_generate_v4(),

  -- Anonymous identifier (stored in cookie)
  anonymous_id text unique not null,

  -- Attribution (captured on first visit, updated if new UTMs arrive)
  first_source text,                -- organic, paid, social, direct, referral, ai_referral
  first_medium text,                -- cpc, email, social, etc.
  first_campaign text,
  first_referrer text,              -- full referrer URL
  first_referrer_domain text,       -- extracted domain
  is_ai_traffic boolean default false,  -- true if referred by ChatGPT, Perplexity, Claude, Gemini
  ai_referrer_source text,          -- which AI (chatgpt, perplexity, claude, gemini)

  -- Latest visit attribution (overwrites on each visit with UTMs)
  latest_source text,
  latest_medium text,
  latest_campaign text,
  latest_referrer text,

  -- Profile (built up over time by personalization engine)
  segment text,                     -- assigned visitor segment
  visit_count integer default 1,
  first_seen_at timestamptz default now(),
  last_seen_at timestamptz default now(),
  pages_viewed text[] default '{}',
  content_affinities text[] default '{}',   -- semantic tags they engage with most

  -- Device info
  device_type text,                 -- mobile, desktop, tablet
  browser text,
  os text,
  country text,
  city text,

  -- Lead conversion (populated when they opt in)
  lead_id uuid,                     -- FK to leads table, set on email capture

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Index for cookie lookups (every request hits this)
create index idx_visitors_anonymous_id on visitors(anonymous_id);

-- Index for segmentation queries
create index idx_visitors_segment on visitors(segment);

-- Index for AI traffic analysis
create index idx_visitors_ai_traffic on visitors(is_ai_traffic) where is_ai_traffic = true;

-- Updated_at trigger
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger visitors_updated_at
  before update on visitors
  for each row execute function update_updated_at();


-- SOURCE: 002_content_objects.sql
-- Migration 002: Content Objects + SEO Meta
-- Every piece of content is a structured object, NOT an HTML blob.
-- Semantic tags, associated offers, and target segments enable
-- personalization and agent-driven content management.

create type content_status as enum ('draft', 'published', 'archived');
create type content_type as enum ('article', 'case_study', 'video', 'guide', 'landing_page', 'snippet');
create type content_creator as enum ('human', 'content_agent', 'seo_agent');

create table seo_meta (
  id uuid primary key default uuid_generate_v4(),

  -- Core meta
  title text,                       -- <title> tag / og:title
  description text,                 -- meta description / og:description
  canonical_url text,
  og_image_url text,

  -- Structured data hints (used by JsonLd generator)
  schema_type text default 'Article',  -- Article, HowTo, FAQ, CaseStudy, etc.
  breadcrumb_path jsonb,               -- [{"name":"Home","url":"/"},{"name":"Blog","url":"/blog"}]

  -- SEO tracking
  target_keyword text,
  secondary_keywords text[] default '{}',
  keyword_cluster text,             -- which cluster from seo/keyword-clusters.md

  -- Performance (updated by SEO Agent)
  current_rank integer,
  impressions_30d integer default 0,
  clicks_30d integer default 0,
  ctr_30d numeric(5,2),

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create trigger seo_meta_updated_at
  before update on seo_meta
  for each row execute function update_updated_at();

create table content_objects (
  id uuid primary key default uuid_generate_v4(),

  -- Identity
  slug text unique not null,
  title text not null,
  subtitle text,
  content_type content_type not null default 'article',

  -- Body (structured markdown — rendered by ArticleBody component)
  body text,
  excerpt text,                     -- short preview for cards, meta descriptions

  -- Classification
  semantic_tags text[] default '{}',         -- topic tags: ["ai-automation", "premium-positioning"]
  associated_offers uuid[] default '{}',     -- FK references to offers table
  target_segments text[] default '{}',       -- which visitor segments see this: ["first-visit", "organic"]

  -- SEO
  seo_meta_id uuid references seo_meta(id),

  -- Media
  featured_image_url text,
  featured_video_url text,

  -- Performance (updated by analytics cron)
  view_count integer default 0,
  unique_visitors integer default 0,
  avg_time_on_page integer default 0,       -- seconds
  conversion_count integer default 0,
  engagement_score numeric(5,2) default 0,  -- calculated metric

  -- Authorship
  status content_status default 'draft',
  created_by content_creator default 'human',
  author_name text,
  published_at timestamptz,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Slug lookup (every page load for blog/content pages)
create index idx_content_slug on content_objects(slug);

-- Status filter (published content queries)
create index idx_content_status on content_objects(status);

-- Type filter
create index idx_content_type on content_objects(content_type);

-- Semantic tag search (GIN index for array contains queries)
create index idx_content_tags on content_objects using gin(semantic_tags);

-- Segment targeting
create index idx_content_segments on content_objects using gin(target_segments);

create trigger content_objects_updated_at
  before update on content_objects
  for each row execute function update_updated_at();


-- SOURCE: 003_offers.sql
-- Migration 003: Offers
-- The value ladder. Each offer maps to a visitor segment and
-- can be dynamically matched by the personalization engine.

create type offer_status as enum ('active', 'paused', 'archived');

create table offers (
  id uuid primary key default uuid_generate_v4(),

  -- Identity
  slug text unique not null,
  name text not null,
  tagline text,                     -- short hook for the offer
  description text,                 -- full description (markdown)

  -- Pricing
  price_display text,               -- "$7/month", "Price on application"
  price_cents integer,              -- actual price in cents (null for POA)
  currency text default 'USD',
  billing_cycle text,               -- "monthly", "one-time", "custom"

  -- Targeting
  who_its_for text,                 -- ICP description for this offer
  target_segments text[] default '{}',  -- visitor segments to show this to
  position_in_ladder integer,       -- 1=entry, 5=top tier

  -- Content
  benefits text[] default '{}',     -- list of what they get
  cta_text text,                    -- "Join for $7/month", "Apply for VIP"
  cta_url text,                     -- where the CTA links to
  featured_image_url text,

  -- Status
  status offer_status default 'active',

  -- Performance (updated by analytics cron)
  view_count integer default 0,
  click_count integer default 0,
  conversion_count integer default 0,
  conversion_rate numeric(5,2) default 0,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_offers_slug on offers(slug);
create index idx_offers_status on offers(status);
create index idx_offers_segments on offers using gin(target_segments);
create index idx_offers_ladder on offers(position_in_ladder);

create trigger offers_updated_at
  before update on offers
  for each row execute function update_updated_at();


-- SOURCE: 004_leads_analytics.sql
-- Migration 004: Leads + Analytics Events
-- Leads are created on email capture (visitor opts in).
-- Analytics events track every meaningful interaction.

create type lead_status as enum ('new', 'engaged', 'qualified', 'converted', 'lost');

create table leads (
  id uuid primary key default uuid_generate_v4(),

  -- Contact (PII — only captured on opt-in)
  email text unique not null,
  first_name text,
  last_name text,

  -- Source
  visitor_id uuid references visitors(id),
  source text,                      -- which form/trigger captured them
  capture_page text,                -- URL where they opted in

  -- Qualification
  status lead_status default 'new',
  score integer default 0,          -- lead score (updated by rules/agents)
  tags text[] default '{}',

  -- Offer interest
  interested_offers uuid[] default '{}',  -- FK to offers

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_leads_email on leads(email);
create index idx_leads_status on leads(status);
create index idx_leads_visitor on leads(visitor_id);

create trigger leads_updated_at
  before update on leads
  for each row execute function update_updated_at();

-- Now add the FK from visitors to leads
alter table visitors
  add constraint fk_visitors_lead
  foreign key (lead_id) references leads(id);

-- Analytics Events
-- High-volume table. Every page view, click, conversion, etc.
-- Designed for fast inserts and time-range queries.

create table analytics_events (
  id uuid primary key default uuid_generate_v4(),

  -- Who
  visitor_id uuid references visitors(id),
  anonymous_id text not null,       -- denormalized for fast writes without join

  -- What
  event_type text not null,         -- page_view, cta_click, offer_view, email_capture, chat_start, etc.
  event_data jsonb default '{}',    -- flexible payload per event type

  -- Where
  page_url text,
  page_slug text,
  referrer text,

  -- Context
  content_id uuid,                  -- FK to content_objects if relevant
  offer_id uuid,                    -- FK to offers if relevant
  visitor_segment text,             -- denormalized for fast analytics

  -- When
  created_at timestamptz default now()
);

-- Time-range queries (most common analytics pattern)
create index idx_events_created on analytics_events(created_at desc);

-- Event type filtering
create index idx_events_type on analytics_events(event_type);

-- Visitor journey
create index idx_events_visitor on analytics_events(visitor_id);

-- Anonymous ID for pre-profile events
create index idx_events_anonymous on analytics_events(anonymous_id);

-- Page performance
create index idx_events_page on analytics_events(page_slug, event_type);


-- SOURCE: 005_entities.sql
-- Migration 005: Entities + Entity Relationships
-- The knowledge graph. Every entity (person, org, service, concept)
-- lives here. JSON-LD is generated dynamically from this data.
-- SEO Agent maintains and updates the graph.

create type entity_type as enum (
  'organization', 'person', 'service', 'product',
  'article', 'case_study', 'concept', 'event',
  'place', 'thing'
);

create table entities (
  id uuid primary key default uuid_generate_v4(),

  -- Identity
  slug text unique not null,        -- url-friendly identifier
  name text not null,
  entity_type entity_type not null,

  -- Schema.org mapping
  schema_type text not null,        -- Organization, Person, Service, Article, Thing, etc.
  schema_id text,                   -- @id value, e.g. "https://www.yourdomain.com/#org"

  -- Core data
  description text,
  url text,                         -- canonical URL for this entity
  image_url text,
  image_width integer,
  image_height integer,

  -- Linked identifiers (sameAs for knowledge graph)
  same_as text[] default '{}',      -- external URLs: LinkedIn, Crunchbase, Wikidata, etc.

  -- Flexible structured data (varies by entity type)
  -- This is the catch-all for type-specific fields like jobTitle, areaServed, etc.
  properties jsonb default '{}',

  -- Topics this entity knows about (for knowsAbout schema)
  knows_about jsonb default '[]',   -- [{"@type":"Thing","name":"Marketing","sameAs":"https://wikidata.org/..."}]

  -- Pages this entity should appear on (for JsonLd component)
  appears_on_pages text[] default '{}',  -- ["/", "/about", "/services"]

  -- Management
  managed_by text default 'human',  -- human, seo_agent
  last_audited_at timestamptz,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_entities_slug on entities(slug);
create index idx_entities_type on entities(entity_type);
create index idx_entities_schema_id on entities(schema_id);
create index idx_entities_pages on entities using gin(appears_on_pages);

create trigger entities_updated_at
  before update on entities
  for each row execute function update_updated_at();

-- Entity Relationships
-- Connects entities to each other with typed relationships.
-- e.g. [Your Name] --[founder_of]--> [Your Brand]
--      [Client] --[client_of]--> [Your Brand]

create table entity_relationships (
  id uuid primary key default uuid_generate_v4(),

  -- The relationship
  subject_id uuid not null references entities(id) on delete cascade,
  predicate text not null,          -- founder_of, client_of, provides, knows_about, part_of, etc.
  object_id uuid not null references entities(id) on delete cascade,

  -- Optional metadata
  properties jsonb default '{}',    -- any extra data about this relationship
  weight numeric(3,2) default 1.0,  -- relationship strength (for ranking)

  created_at timestamptz default now(),

  -- Prevent duplicate relationships
  unique(subject_id, predicate, object_id)
);

create index idx_rel_subject on entity_relationships(subject_id);
create index idx_rel_object on entity_relationships(object_id);
create index idx_rel_predicate on entity_relationships(predicate);


-- SOURCE: 006_personalization_rules.sql
-- Migration 006: Personalization Rules
-- JSON rules evaluated per visitor on each page load.
-- The middleware reads these to determine which variant to serve.

create type rule_status as enum ('active', 'paused', 'archived');

create table personalization_rules (
  id uuid primary key default uuid_generate_v4(),

  -- Identity
  name text not null,
  description text,

  -- Rule definition (evaluated by the personalization engine)
  -- Condition: JSON object describing when this rule applies
  -- e.g. {"source": "organic", "first_visit": true, "referrer_domain": "google.com"}
  condition jsonb not null,

  -- Action: JSON object describing what to do when the rule matches
  -- e.g. {"hero_variant": "seo-focused", "cta_text": "See how we rank", "featured_offers": ["seo-audit"]}
  action jsonb not null,

  -- Targeting
  page_patterns text[] default '{}',  -- which pages this rule applies to: ["/", "/services/*"]

  -- Priority (higher number = evaluated first, first match wins)
  priority integer default 0,

  -- Status
  status rule_status default 'active',

  -- Performance tracking
  impressions integer default 0,
  conversions integer default 0,
  conversion_rate numeric(5,2) default 0,

  -- Management
  created_by text default 'human',  -- human, cron_agent
  last_evaluated_at timestamptz,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_rules_status on personalization_rules(status);
create index idx_rules_priority on personalization_rules(priority desc);
create index idx_rules_pages on personalization_rules using gin(page_patterns);

create trigger personalization_rules_updated_at
  before update on personalization_rules
  for each row execute function update_updated_at();


-- SOURCE: 007_email_system.sql
-- Migration 007: Email System
-- Sequences, sends, and events. Managed via API by agents.
-- Resend handles delivery, we track everything here.

create type sequence_status as enum ('active', 'paused', 'archived');
create type send_status as enum ('pending', 'sent', 'failed', 'bounced');
create type email_event_type as enum ('delivered', 'opened', 'clicked', 'bounced', 'complained', 'unsubscribed');

create table email_sequences (
  id uuid primary key default uuid_generate_v4(),

  -- Identity
  name text not null,               -- "Welcome Series", "Exit Intent Follow-up"
  description text,

  -- Trigger
  trigger_type text not null,       -- form_submission, exit_intent, tag_added, agent_initiated, time_based
  trigger_config jsonb default '{}', -- e.g. {"form": "email-capture", "delay_minutes": 0}

  -- Steps (ordered array of email steps)
  -- Each step: {"step": 1, "subject": "...", "template_id": "...", "delay_hours": 0}
  steps jsonb not null default '[]',

  -- Targeting
  target_segments text[] default '{}',

  -- Status
  status sequence_status default 'active',

  -- Performance
  total_enrolled integer default 0,
  total_completed integer default 0,
  avg_open_rate numeric(5,2) default 0,
  avg_click_rate numeric(5,2) default 0,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create trigger email_sequences_updated_at
  before update on email_sequences
  for each row execute function update_updated_at();

create table email_sends (
  id uuid primary key default uuid_generate_v4(),

  -- Who
  lead_id uuid not null references leads(id),
  email_address text not null,

  -- What
  sequence_id uuid references email_sequences(id),
  step_number integer,              -- which step in the sequence
  subject text not null,
  template_id text,                 -- Resend template reference

  -- Delivery
  resend_id text,                   -- Resend's message ID
  status send_status default 'pending',
  sent_at timestamptz,
  error_message text,

  created_at timestamptz default now()
);

create index idx_sends_lead on email_sends(lead_id);
create index idx_sends_sequence on email_sends(sequence_id);
create index idx_sends_status on email_sends(status);

create table email_events (
  id uuid primary key default uuid_generate_v4(),

  -- References
  send_id uuid not null references email_sends(id),
  lead_id uuid not null references leads(id),

  -- Event
  event_type email_event_type not null,
  event_data jsonb default '{}',    -- click URL, bounce reason, etc.

  created_at timestamptz default now()
);

create index idx_email_events_send on email_events(send_id);
create index idx_email_events_lead on email_events(lead_id);
create index idx_email_events_type on email_events(event_type);


-- SOURCE: 008_conversations.sql
-- Migration 008: Conversations + Messages
-- On-site chat (Claude API) and WhatsApp (OpenClawd).
-- Context-aware: chat knows the visitor's page, segment, and history.

create type conversation_channel as enum ('web_chat', 'whatsapp');
create type conversation_status as enum ('active', 'closed', 'archived');
create type message_role as enum ('user', 'assistant', 'system');

create table conversations (
  id uuid primary key default uuid_generate_v4(),

  -- Who
  visitor_id uuid references visitors(id),
  lead_id uuid references leads(id),    -- set if visitor has opted in

  -- Channel
  channel conversation_channel not null default 'web_chat',
  external_id text,                      -- WhatsApp thread ID, etc.

  -- Context (captured at conversation start)
  started_on_page text,                  -- URL where chat was initiated
  visitor_segment text,                  -- segment at time of chat start
  context jsonb default '{}',            -- any extra context passed to the agent

  -- Status
  status conversation_status default 'active',
  message_count integer default 0,

  -- Timestamps
  started_at timestamptz default now(),
  last_message_at timestamptz default now(),
  closed_at timestamptz,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_conversations_visitor on conversations(visitor_id);
create index idx_conversations_status on conversations(status);
create index idx_conversations_channel on conversations(channel);

create trigger conversations_updated_at
  before update on conversations
  for each row execute function update_updated_at();

create table messages (
  id uuid primary key default uuid_generate_v4(),

  conversation_id uuid not null references conversations(id) on delete cascade,

  -- Message
  role message_role not null,       -- user, assistant, system
  content text not null,

  -- Metadata
  token_count integer,              -- for cost tracking
  model text,                       -- which model generated this (for assistant messages)
  metadata jsonb default '{}',      -- tool calls, function results, etc.

  created_at timestamptz default now()
);

create index idx_messages_conversation on messages(conversation_id, created_at);


-- SOURCE: 009_media_agent_logs.sql
-- Migration 009: Media + Agent Logs
-- Media: references to files in Cloudflare R2.
-- Agent Logs: every agent action is recorded for audit and debugging.

create table media (
  id uuid primary key default uuid_generate_v4(),

  -- File info
  filename text not null,
  mime_type text not null,
  file_size integer,                -- bytes
  width integer,                    -- for images
  height integer,                   -- for images
  duration integer,                 -- for video/audio, in seconds

  -- Storage
  r2_key text unique not null,      -- Cloudflare R2 object key
  url text not null,                -- public URL

  -- Metadata
  alt_text text,                    -- accessibility
  caption text,
  tags text[] default '{}',

  -- Usage tracking
  used_in_content uuid[] default '{}',  -- content_objects that reference this

  -- Authorship
  uploaded_by text default 'human', -- human, content_agent

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_media_r2_key on media(r2_key);
create index idx_media_mime on media(mime_type);
create index idx_media_tags on media using gin(tags);

create trigger media_updated_at
  before update on media
  for each row execute function update_updated_at();

-- Agent Logs
-- Every agent action is logged: who did what, when, and what happened.
-- This is the audit trail for all AI-driven changes.

create type agent_name as enum ('content_agent', 'seo_agent', 'openclawd', 'analytics_agent', 'email_agent');
create type agent_action_status as enum ('started', 'completed', 'failed');

create table agent_logs (
  id uuid primary key default uuid_generate_v4(),

  -- Who
  agent agent_name not null,

  -- What
  action text not null,             -- "create_article", "update_entity", "send_email", "audit_seo"
  description text,                 -- human-readable summary of what happened
  status agent_action_status default 'started',

  -- Context
  target_table text,                -- which table was affected
  target_id uuid,                   -- which row was affected
  input_data jsonb default '{}',    -- what the agent was given
  output_data jsonb default '{}',   -- what the agent produced
  error_message text,               -- if failed

  -- Performance
  duration_ms integer,              -- how long the action took
  tokens_used integer,              -- LLM tokens consumed (for cost tracking)

  created_at timestamptz default now()
);

create index idx_agent_logs_agent on agent_logs(agent);
create index idx_agent_logs_action on agent_logs(action);
create index idx_agent_logs_status on agent_logs(status);
create index idx_agent_logs_created on agent_logs(created_at desc);
create index idx_agent_logs_target on agent_logs(target_table, target_id);


-- SOURCE: 010_content_calendar.sql
-- Migration 010: Content Calendar
-- The content pipeline: topics are generated by the content strategy agent,
-- prioritized, approved, written, and published. This table tracks every stage.

create type calendar_status as enum (
  'planned',
  'approved',
  'writing',
  'draft',
  'published',
  'archived'
);

create type intent_type as enum (
  'how_to',
  'comparison',
  'definition',
  'informational',
  'commercial',
  'transactional',
  'listicle',
  'case_study',
  'opinion'
);

create type calendar_priority as enum ('high', 'medium', 'low');

create table content_calendar (
  id uuid primary key default uuid_generate_v4(),

  -- Topic info
  title text not null,                          -- proposed article title
  search_query text,                            -- the original audience search query
  target_keyword text,                          -- primary SEO keyword
  keyword_cluster text,                         -- references a cluster from keyword-clusters.md
  intent_type intent_type default 'informational',

  -- Prioritization
  priority calendar_priority default 'medium',

  -- Pipeline status
  status calendar_status default 'planned',

  -- Organization
  pillar_topic text,                            -- which of the 4 content pillars
  topic_cluster text,                           -- subtopic cluster within a pillar
  scheduled_publish_date date,                  -- when it should be published

  -- Links to published content
  content_object_id uuid references content_objects(id),  -- populated when article is written
  seo_meta_id uuid references seo_meta(id),               -- populated when SEO meta is created

  -- Batch tracking
  run_id text,                                  -- e.g. BB-CS-2026-03-25-01 or BB-TRENDS-2026-03-25

  -- Authorship
  created_by text default 'human',              -- human, content_agent, trend_scanner
  notes text,                                   -- for human review comments

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Indexes for common queries
create index idx_calendar_status on content_calendar(status);
create index idx_calendar_priority on content_calendar(priority);
create index idx_calendar_keyword_cluster on content_calendar(keyword_cluster);
create index idx_calendar_run_id on content_calendar(run_id);
create index idx_calendar_scheduled on content_calendar(scheduled_publish_date);

-- Prevent duplicate topics targeting the same keyword
create unique index idx_calendar_unique_topic
  on content_calendar(search_query, target_keyword)
  where status != 'archived';

create trigger calendar_updated_at
  before update on content_calendar
  for each row execute function update_updated_at();


-- SOURCE: 011_security_policies.sql
alter table visitors enable row level security;
alter table seo_meta enable row level security;
alter table content_objects enable row level security;
alter table offers enable row level security;
alter table leads enable row level security;
alter table analytics_events enable row level security;
alter table entities enable row level security;
alter table entity_relationships enable row level security;
alter table personalization_rules enable row level security;
alter table email_sequences enable row level security;
alter table email_sends enable row level security;
alter table email_events enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table media enable row level security;
alter table agent_logs enable row level security;
alter table content_calendar enable row level security;

drop policy if exists "Public read published content" on content_objects;
create policy "Public read published content"
  on content_objects
  for select
  to anon, authenticated
  using (status = 'published');

drop policy if exists "Public read active offers" on offers;
create policy "Public read active offers"
  on offers
  for select
  to anon, authenticated
  using (status = 'active');
