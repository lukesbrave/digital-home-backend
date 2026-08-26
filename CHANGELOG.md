# Changelog

All notable changes to the Digital Home Backend Starter.

## [Unreleased]

The CRM home becomes the **Command Centre** — the page that answers "what's
the state of my business?" in five seconds. One status sentence, the business
drawn as a flowing Leads → Nurture → Pipeline → Revenue strip (animated
connectors, each stage clickable through to its working screen), a "Waiting
on you" panel of open tasks, upcoming appointments, and a live activity feed
refreshing every 20 seconds. The sidebar leads with Command and its working
screens; logging in lands there.

Revenue now reaches the ledger: a payment webhook capturing
`custom.booking_amount_cents` (e.g. Stripe event bookings on the frontend)
automatically records a WON opportunity at the booking amount — idempotent
per Stripe session, test-mode ignored. A one-time
`scripts/backfill-event-bookings.mjs` records historical bookings that
landed on leads before this shipped. The landing stage is configurable via
the `crm_won_stage_name` setting (defaults to the pipeline's last stage).

Pipeline value becomes a forecast: open deals with no value contribute their
stage's estimate from the `crm_stage_estimates` setting
(`{ "default_cents": 1400, "stages": { "Nurturing": 14700 } }`); the Command
Centre shows estimated totals with a `~` marker so forecast is never mistaken
for booked money. No database migration is required.

The lead detail page now tells the lead's whole story: an at-a-glance strip
(score, source, next appointment, open tasks), an attribution card (capture
source, funnel first touch with UTMs and referrer, linked website-visitor
intel), a collected-data card showing every submitted custom key, and a
day-grouped timeline with filter chips (all/emails/notes/system) where email
entries open the stored as-sent preview. The unused custom-fields editor is
gone from the page (definitions stay manageable in Settings; merge tags and
workflows read `lead.custom` directly). Two new capabilities ride along: a
one-off email composer (`POST /api/crm/leads/[id]/email`) that sends through
the normal engine — merge tags, suppression, and safe mode all apply — and
inbound reply capture: the Resend webhook now handles `email.received`,
matching a reply to its lead by sender address, logging it on the timeline,
and promoting a `new` lead to `engaged`. Enabling replies needs only an MX
record on the SENDING subdomain (never the root domain) plus the inbound
event ticked on the Resend webhook. No database migration is required.

CRM capture now accepts validated UUID offer references and surfaces
lead-lookup failures instead of treating them as a missing lead. The paired
frontend starter now routes public lead capture through this endpoint, strips
privileged workflow/provider fields, links the anonymous visitor through
`visitors.lead_id`, provides fail-closed handling for payment/entitlement
events, and preserves contact messages in its non-critical fallback. No
database migration is required; frontend deployments must configure
`BACKEND_URL` and set `CRM_CAPTURE_KEY` to
`backend_settings.crm_capture_key`.

## [2.6.0] — 2026-08-21

The brand playbook page:

- New `/brand` page ("Brand" in the sidebar) is your playbook shelf: one
  card per brand research playbook you have run, newest first, with the
  current one marked. Click a card to read the whole playbook — audience,
  transformation, urgency gateway, pain points, language map, where they
  gather, marketing recommendation, competitive landscape, the offer, plus
  your standing copy rules, proof asset, and known gaps.
- **It starts empty.** Your Digital Home ships with no brand research in
  it. When your brand strategist runs your research, it writes the result
  to `brand/playbook.json` and the page fills itself in — nothing to wire.
- Its shape is documented in `brand/playbook.schema.json`. Each playbook
  carries its own `narrative` block (standing copy rules, proof asset,
  known gaps, never-say list), so a playbook is self-contained and nothing
  has to be kept in sync by hand.
- To keep an old playbook when you run new research, archive it into
  `brand/playbooks/` — see the instructions in `brand/playbooks/index.ts`.
- The sidebar wordmark now reads "Digital Home".
- No database changes.

## [2.5.11] — 2026-08-20

Multi-funnel dashboard:

- The funnel dashboard now handles more than one funnel. Every funnel
  registers itself the moment its first event arrives (the slug the funnel
  template sends with each event is the registration; nothing to configure),
  and a funnel selector appears in the dashboard header once a second
  funnel exists. The default view is the busiest funnel in the window.
- The stats API (`/api/crm/funnel`) returns the distinct funnels seen in
  the window with session counts, and each funnel's domain is derived from
  its own event URLs. No database changes.

## [2.5.10] — 2026-08-20

Funnel capture with a single secret:

- The lead capture endpoint (`/api/crm/capture`) now also accepts the
  `crm_funnel_secret` value in its `x-capture-key` header. Funnels built
  from `digital-home-funnel-starter` send one secret to both the analytics
  ingest and lead capture doors; previously leads only landed when the
  separate `crm_capture_key` setting held the same value. One secret now
  works out of the box. No database changes.

## [2.5.9] — 2026-08-18

Social scheduling and Facebook analytics hardening:

- Retrying a failed or partially published post preserves its original
  `scheduled_at` calendar slot. Previously the retry time replaced the
  intended publish time, making 11:00 posts appear to move to early morning.
- Facebook Reel snapshots no longer request the retired
  `post_impressions_unique` metric. Plays, social actions, likes, and comments
  are fetched independently, so one unavailable Meta metric cannot discard an
  otherwise valid snapshot. Facebook Reel reach remains zero because Graph
  API v23 does not expose a compatible replacement.
- The native Cloudflare social cron now logs a compact result summary. An
  explicit `SOCIAL_SCHEDULER_MODE` (`native` or `external`) supports safe
  cutovers for customized deployments without ever running two schedulers.
- Added focused retry and Meta regression tests under `npm run test:social`.

No database migration is required.

## [2.5.8] — 2026-08-18

Cosmetic cleanup: removed the leftover v0.1 and v0.2 labels from the
login page, sidebar, and content pages. Those labels predated the
current release numbering and made a freshly deployed backend look
outdated. Your real version lives in the VERSION file and release tags.
No database or environment changes are required.

## [2.5.7] — 2026-08-17

Three quality-of-life and correctness fixes:

- The Leads list now defaults to newest-created records, adds explicit
  priority and recent-activity views, and shows lead scores in the table.
- Article status stays in sync with the content calendar: moving a calendar
  entry to draft, published, or archived updates the linked article, a
  publication date is preserved when unpublishing and set on first
  publication, and the article state is restored if the calendar update
  fails. Previously, dragging a published article back to Draft left it
  live on the public site while the CMS showed it as a draft.
- Clean-checkout builds no longer fail on the generated-module import in
  `worker.ts` — a fresh clone now builds first time. No database or
  environment changes are required.

## [2.5.6] — 2026-08-07

Social platforms for one post now begin concurrently, so an Instagram
transcode or Facebook API wait cannot leave YouTube locally pending. Pending
targets use an atomic short lease to prevent overlapping cron/manual ticks
from creating duplicate platform uploads. YouTube also begins transferring
chunks immediately after its resumable session is durably saved. The tick API
and CLI accept an optional post ID for safely advancing one post in isolation.
No database or environment changes are required.

## [2.5.5] — 2026-08-07

Raised normalized social-video quality from a 6 Mbps ceiling to a true
8 Mbps target, while retaining a 60 MiB hard safety cap. The incident's
57.8-second, 139 MB screen recording now normalizes to 55.7 MiB at roughly
7.95 Mbps—more detail for UI text and motion without returning to oversized
raw payloads. No database or environment changes are required.

## [2.5.4] — 2026-08-07

Video publishing is now safe for large screen-recording exports:

- The studio and CLI normalize every video to a bounded-bitrate 1080×1920
  H.264 MP4 before upload, even when the source is already 9:16. Both paths
  fail closed instead of silently queueing an oversized raw file.
- YouTube resumable session URIs are persisted before bytes move. Uploads use
  8 MiB `Content-Range` chunks and retries probe Google's accepted offset,
  preventing a retry from creating another channel video.
- Targets with a final platform `external_id` can never re-enter an upload
  path, even if their local status is inconsistent.
- Added focused tests for session creation, chunk boundaries, and mid-upload
  resume. No database migration is required.

## [2.5.3] — 2026-08-06

Performance metrics actually record now. Three faults were stacking up, and
a silent `catch` was hiding all of them — a tick would report success while
capturing nothing at all:

- Instagram likes and comments now come from the media object, so engagement
  records even when insights are unavailable. Reach, views and saves need the
  `instagram_manage_insights` permission — see SOCIAL.md, it is not in Meta's
  default scope set.
- Facebook stopped requesting `post_impressions` / `post_impressions_unique`,
  which Meta retired from the Graph API; asking for them failed the whole
  call, so Facebook recorded nothing.
- Metric fetch failures now surface in the tick summary instead of being
  swallowed.
- `POST /api/social/tick` accepts `metricsForce: true` to bypass the 6-hour
  snapshot gate when you want fresh numbers immediately.

## [2.5.2] — 2026-08-05

Publish-engine resilience, straight from a real-world failed publish:

- A post whose platform publishes all fail mid-retry no longer locks in
  "publishing" (uneditable) — it returns to "scheduled" between attempts,
  so it stays editable and cancellable.
- Instagram image retries now cache-bust the media URL. IG caches
  per-URL fetch failures (error code 9004), so bare retries of the same
  URL could never succeed.
- New "Move to draft" action in the studio on scheduled, canceled, and
  failed posts.

## [2.5.1] — 2026-08-03

Social calendar fixes, straight from production use:

- Carousels now render as carousels in the post modal (previously showed
  only the first slide).
- The `social-manager` role can read connected accounts (previously
  couldn't see which platforms were wired up).
- The studio board self-heals when a post was replaced or deleted in
  another session (no more stale "Not found" errors).

## [2.5.0] — 2026-08-03

The operating-system release: your backend grows from a content pipeline
into a full CRM, email automation engine, social calendar, and bookings
system.

### Added

**CRM (the headline)**
- AI-native CRM at `/crm`: leads, activity timelines, custom fields, tags,
  pipelines with drag-through stages, opportunities, and tasks.
- Universal capture endpoint (`POST /api/crm/capture`, key-protected) —
  point every form on your site at it; leads upsert with full activity
  history.
- Auto-pipeline: every real inbound lead opens an opportunity in your first
  stage; entering an email sequence advances it (forward-only).
- Email workflow engine: sequences with wait/tag/stage/webhook/task steps,
  AI-drafted sequences and rewrites (bring your Anthropic key), A/B subject
  tests, per-send open/click tracking, sent-email viewer.
- Safe mode ON by default — workflows run fully but sends are simulated
  until you flip the switch. Suppression, bounce circuit-breaker,
  reputation send-budget, and optional business-hours send windows built in.
- Lead scoring, engagement sensing, hot-lead alerts, attribution, and a
  weekly report.
- Funnel analytics: ingest events from any funnel, see step-by-step stats
  at `/crm/funnel`.
- Engine tick runs on a native Cloudflare cron (no GitHub Action needed).

**Social calendar**
- Social studio at `/social`: plan, compose, and publish to Instagram,
  Facebook, and YouTube from one calendar.
- **Post Now**: publish immediately from the composer (fire-and-forget —
  the engine runs inline and the calendar card tracks progress).
- Multi-slide carousels, single-photo posts, and short-form video
  distribution (IG Reels / FB Reels / YouTube Shorts).
- Media storage on Cloudflare R2: multipart uploads (no 50MB cap), free
  egress for Meta's pulls, refcounted deletion. Images auto-normalize to
  JPEG and auto-crop into Instagram's accepted ratio range on upload;
  video aspect guards warn on non-9:16.
- Meta business-login connect flow + manual connect script; Google OAuth
  for YouTube.
- `social-manager` role for team members who only touch social.

**Bookings**
- Cal.com integration: webhook sync, appointment tracking in the CRM, and
  automatic 24h/1h reminder emails.

**Content pipeline**
- Per-article image direction with cinematic hero style.
- Pull quotes, canonical internal links, pillar-topic directives, and
  deeper long-form output.
- Archived articles free up weekly calendar slots.

**Dashboard**
- Full design-system rework: light/dark mode, legible typography,
  collapsible sidebar with CRM and Social sections.

### Database
- New migration `supabase/migrations/002_crm_core.sql` (CRM, funnel,
  social, bookings schema). Requires the Frontend Starter's base
  migrations (001–011) — already applied if your Digital Home is set up.
- `src/types/database.ts` updated — must stay identical to the copy in
  the Frontend Starter (companion frontend release syncs it).

### Upgrading
See [UPGRADE.md](UPGRADE.md) — written to be handed to Claude Code inside
your own backend project.
