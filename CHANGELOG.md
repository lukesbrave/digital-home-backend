# Changelog

All notable changes to the Digital Home Backend Starter.

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
