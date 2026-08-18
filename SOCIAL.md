# Social — short-form distribution engine

Schedule a post once in the **Social studio** (`/social`) and the engine
publishes it, then tracks views/likes/comments per platform. Two post shapes:

- **Video** — Instagram Reels, Facebook Reels, YouTube Shorts.
- **Images** (post_type `carousel`) — 1–10 ordered slides.
  One slide publishes a single photo (IG feed photo + FB photo post); 2–10
  publish as an Instagram carousel + Facebook multi-photo post. YouTube has
  no image format, so YouTube targets are auto-`skipped`.

Built to replace GHL's content calendar for short-form: upload → caption →
pick platforms → schedule (or Publish now). The studio has two views — the
month **calendar** and a GHL-style **list** (search, status + date-range
filters); the toggle in the header sticks per browser.

A social media manager gets a real account boundary: create their login with
`npx tsx --env-file=.env.local scripts/create-user.ts <password> <email> social`
— the `social` role is confined to `/social` (middleware redirects pages, and
every non-social API route rejects social-role sessions). Re-running the same
command flips a role, so promote/demote is one line.

## How it works

- **Storage** — media lives in the **`social-media` Cloudflare R2 bucket**
  (no 50MB cap, free egress for Meta's pulls). Uploads go through the API in
  ~40MB multipart chunks (`/api/social/upload` → `…/part` → `…/complete`,
  scoped token auth), and files serve publicly from your media domain — a
  custom domain you attach to the bucket (e.g. `media.yourdomain.com`, set
  via `R2_PUBLIC_BASE`). Meta ingests by pulling that URL; YouTube
  gets the bytes streamed by the worker. Note: deleted objects can stay
  edge-cached for a while.
- **Engine** — `POST /api/social/tick` (idempotent, mirrors the CRM tick).
  The Cloudflare cron in `wrangler.jsonc` fires it every 5 minutes once the
  worker is deployed. Posts go `scheduled → publishing → published/partial/failed`;
  each platform target is its own state machine (Meta transcodes async, so a
  target can sit in `processing` across ticks). 3 retry attempts, 45-min
  processing deadline.
- **Image posts** — the browser (or `scripts/social-post.mjs`) uploads each
  slide to the same bucket, and both **auto-normalize on upload**: everything
  re-encodes to JPEG and anything outside Instagram's 4:5–1.91:1 range is
  center-cropped to the nearest bound (a raw phone photo is 3:4), capped at
  1440px wide — the preview is exactly what publishes. On publish: 1 slide →
  a single IG IMAGE container / FB photo post; 2–10 slides → IG child
  containers → a CAROUSEL container (same status walk as Reels) and an FB
  multi-photo feed post (synchronous — publishes in a single step). Media
  supplied as bare URLs skips normalization, so those must already be JPEG
  and in range.
- **Metrics** — every tick appends fresh snapshots (`social_metrics`) for
  targets published in the last 30 days whose numbers are older than 6 h.
  The Performance tab rolls them up; history is kept for trend charts later.
  Facebook carousels read post reactions, comments, shares, and clicks;
  Facebook Reels read plays, social actions, likes, and comments through
  independent requests so a retired Meta metric cannot erase the snapshot.
- **CLI / Claude** — `scripts/social-post.mjs` runs the whole calendar over
  the HMAC machine API (master key from `.env.local`):
  `accounts` · `list` · `create --caption … --media a.jpg b.jpg --when …` ·
  `publish <id>` · `tick`. It uploads local files, infers video vs carousel
  from the media given, and `--publish-now` schedules + runs the engine
  inline. This is how agent sessions schedule and publish content.

## Data model

`social_accounts` (connected identities + tokens) · `social_posts` (caption,
schedule, `post_type` video|carousel) · `social_post_media` (ordered carousel
slides) · `social_post_targets` (per-platform publish state) ·
`social_metrics` (append-only performance snapshots).

## Setup

### 1. Apply the migration

The social tables and the `social-videos` bucket ship inside
`supabase/migrations/002_crm_core.sql` — run it against your Supabase
project if you haven't already.

### 2. The cron

Nothing to add: the Cloudflare cron in `wrangler.jsonc` runs the social tick
alongside the CRM tick once this worker is deployed (needs the
`API_SECRET_KEY` secret). `SOCIAL_SCHEDULER_MODE` defaults to `native`.
Customized deployments that still have an external/GitHub social schedule
can temporarily set it to `external`, remove the recurring external trigger,
then switch it to `native` and redeploy. Invalid values fail closed and log an
error rather than risking two authoritative schedulers.

### 3. Connect accounts (`/social/accounts`)

**Instagram + Facebook (one connect for both)** — needs a Meta app:

1. [developers.facebook.com](https://developers.facebook.com) → create an app
   (Business type) → add the **Facebook Login for Business** product.
2. App settings → note App ID + App Secret, then on the worker:
   `wrangler secret put META_APP_ID` and `wrangler secret put META_APP_SECRET`.
3. Facebook Login → Settings → Valid OAuth Redirect URIs:
   `https://<your-backend-domain>/api/social/oauth/meta`
4. Permissions needed: `pages_show_list`, `pages_read_engagement`,
   `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`,
   `read_insights`, and **`instagram_manage_insights`**. While the app is in **Development mode** these work for
   any user with a role on the app (add yourself as admin) — App Review is
   only needed to open it to outsiders, which you don't need.
   > **Do not skip `instagram_manage_insights`.** It is NOT part of Meta's
   > default scope set, and without it `/media/insights` returns
   > `(#10) Application does not have permission for this action` — so reach,
   > views and saves silently never arrive. Likes and comments still work
   > (they come from the media object), which makes the gap easy to miss.
   > Already connected without it? Re-mint the token with the extra scope
   > ticked and reconnect; nothing else needs to change.
5. The Instagram account must be a **professional (business/creator) account
   linked to the Facebook page** (Meta Business Suite → Instagram → connect).
6. Hit **Connect Instagram + Facebook** on `/social/accounts`.

*No Meta app yet?* The same button falls back to pasting a long-lived **page
token** from [Graph API Explorer](https://developers.facebook.com/tools/explorer)
(select the page, tick the permissions above, Generate) — it connects the page
and its linked IG account in one go.

**YouTube** — needs a Google Cloud OAuth client:

1. [console.cloud.google.com](https://console.cloud.google.com) → new project →
   enable **YouTube Data API v3**.
2. OAuth consent screen: External, add your Google account as a **test
   user** (test mode is fine — only you connect).
3. Credentials → OAuth client ID (Web application) → authorized redirect URI:
   `https://<your-backend-domain>/api/social/oauth/google`
4. `wrangler secret put GOOGLE_CLIENT_ID` and
   `wrangler secret put GOOGLE_CLIENT_SECRET`.
5. Hit **Connect YouTube** on `/social/accounts`.

> Heads-up: unverified Google apps in test mode issue refresh tokens that
> expire after 7 days. For a set-and-forget connection either publish the
> consent screen (verification not required for these scopes at low volume)
> or reconnect weekly until then.

### 4. Media specs

**Video posts** — 9:16 vertical MP4 (H.264/AAC). Instagram Reels ≤ 3 min,
Facebook Reels ≤ 90 s, YouTube Shorts ≤ 3 min. One video per post; captions
per post with an optional per-platform override (`caption_override` on the
target — API only for now). The post **title** doubles as the YouTube title.

**Image posts** — 1–10 images, ordered. **JPEG strongly recommended**
(Instagram's image ingest only guarantees JPEG; PNG/WebP may fail at publish
time with a container error). 1080×1350 (4:5) is the sweet spot for both
platforms. One image = a single photo post; 2–10 = a true Instagram carousel
+ a Facebook multi-photo page post.

## Ops notes

- Insights lag publishing (IG often 404s insights for the first hour) — the
  metrics pass skips quietly and catches up on a later tick.
- Meta Graph API v23 retired Facebook Reel `post_impressions_unique`, so Reel
  reach is stored as 0 rather than being guessed from plays. The remaining
  Reel metrics are isolated from one another and continue recording if an
  optional metric becomes unavailable.
- "Publish now" runs the engine inline with a short Instagram transcode wait,
  so it usually returns fully published.
- Deleting a post removes its storage object; already-published videos stay
  live on the platforms (delete those natively).
- Disconnecting an account is soft — history and metrics survive; new posts
  just can't target it. Reconnecting the same page/channel reactivates it.
- Meta page tokens minted from a long-lived user token don't expire; if a
  publish starts failing with an OAuth error (the target's error message
  mentions code 190), reconnect from `/social/accounts`.
