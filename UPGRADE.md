# Upgrading your Digital Home Backend

This guide is written to be executed by **Claude Code inside your own
backend project**. Paste this into Claude Code from your backend project
folder:

> Fetch https://raw.githubusercontent.com/lukesbrave/digital-home-backend/main/UPGRADE.md
> and upgrade my backend to the latest version. My project may be
> customized — preserve my changes while applying the upgrade.

---

## Instructions for Claude

You are upgrading a member's Digital Home backend — a customized fork of
`digital-home-backend`. Work inside THEIR project. Their
customizations are intentional: **merge, don't overwrite.** When a file
conflicts, prefer their copy design-wise and add the new capability into it.

### Step 0 — Determine current version
- If a `VERSION` file exists, read it. If it says `2.6.0` or higher, stop —
  already up to date. If it says anything from `2.5.0` through `2.5.11`,
  apply ONLY the "Patch upgrades" section at the bottom of this guide.
- No `VERSION` file = v1.x (content pipeline era). Apply the full v2.5.0
  upgrade below.
- Confirm this is really the backend (has `src/app/api/write-article/` or
  similar) and NOT the frontend. If it's the frontend, stop and say so.

### Step 1 — Preflight
1. `git status` — if there are uncommitted changes, commit or stash them
   first so the upgrade is revertible.
2. Create a branch: `git checkout -b upgrade/v2.6.0`.
3. Add the starter as a remote if missing:
   `git remote add starter https://github.com/lukesbrave/digital-home-backend.git`
   then `git fetch starter --tags`.

### Step 2 — Bring in the latest version
1. Diff `git diff HEAD..v2.6.0 --stat` to see scope.
2. New files (the vast majority) can be checked out directly:
   `git checkout v2.6.0 -- <path>` for: `src/lib/crm/`, `src/lib/social/`,
   `src/app/brand/`, `brand/`,
   `src/app/api/crm/`, `src/app/api/social/`, `src/app/api/settings/`,
   `src/app/api/webhooks/`, `src/app/crm/`, `src/app/social/`,
   `src/components/crm/`, `worker.ts`, `scripts/deploy.sh`,
   `scripts/apply-migration.mjs`, `scripts/connect-meta.mjs`,
   `scripts/social-post.mjs`, `supabase/migrations/002_crm_core.sql`,
   `CRM.md`, `SOCIAL.md`, `BOOKINGS.md`, `CHANGELOG.md`, `VERSION`.
3. Shared files — MERGE these by hand, preserving the member's edits:
   `src/components/sidebar.tsx` (add CRM + Social nav sections),
   `src/middleware.ts`, `src/lib/api/auth.ts` (social role + signed
   requests), `src/types/database.ts` (take the latest copy wholesale unless
   they added their own tables — then merge), `package.json` (add new deps,
   keep theirs), `tsconfig.json`, `wrangler.jsonc` (add the cron trigger;
   KEEP their routes/domains/vars), `src/app/api/write-article/route.ts`
   and `src/app/api/trend-scan/route.ts` (take the latest unless customized).
4. `npm install`.

### Step 3 — Database
1. **Before applying anything, read their env and tell the member which
   Supabase project URL it points at, and ask them to confirm it's theirs.**
   Never apply a migration to a database you haven't confirmed out loud.
2. Apply `supabase/migrations/002_crm_core.sql` to their Supabase project
   (use `scripts/apply-migration.mjs` or the Supabase SQL editor).
   It is additive — no destructive changes.
2. **Frontend pairing:** copy `src/types/database.ts` byte-identical into
   their frontend project (`digital-home-frontend` fork), commit
   there too. Both repos share one Supabase — types must match.

### Step 4 — Configuration
1. Env vars (`.env.local` + Cloudflare secrets): `CAPTURE_KEY` (new —
   generate a random string), `RESEND_API_KEY` (email sending; can wait),
   optional `CALCOM_WEBHOOK_SECRET`, Meta/Google OAuth creds for social
   (can wait — see SOCIAL.md).
2. Keep `SOCIAL_SCHEDULER_MODE` set to `native` unless the member has a
   customized recurring external/GitHub social tick. In that case use the
   gated cutover in the patch instructions below.
3. Safe mode ships ON — emails simulate until they flip
   `crm_safe_mode` off in `/crm/settings`. Tell the member this explicitly.

### Step 5 — Verify (walk the member through it)
1. `npx tsc --noEmit` clean, `npm run build` clean, deploy.
2. Log into the dashboard — CRM and Social appear in the sidebar,
   light/dark toggle works.
3. Point one site form at `POST /api/crm/capture` with the `x-capture-key`
   header → submit it yourself → the lead appears in `/crm` with an
   activity entry and an opportunity in the first stage.
4. Draft a 2-step test workflow, enroll yourself, run "Run engine now" —
   the send appears as `simulated` in the sent-email viewer.
5. Commit, merge the branch, deploy. Done — `VERSION` should read `2.6.0`
   (it comes along with the checkout).

### If something breaks
Revert is always available: `git checkout main` (the upgrade lives on its
branch until merged). The migration is additive and safe to leave applied.

## Patch upgrades (you're already on 2.5.x)

Fetch the starter remote first: `git fetch starter --tags`.

**From 2.5.x → 2.6.0** — add the brand playbook page (do any patch steps
for your version below first, then this):

    git checkout v2.6.0 -- src/app/brand/page.tsx brand/playbook.json brand/playbook.schema.json VERSION CHANGELOG.md

Merge one shared file rather than overwriting customizations:

1. `src/components/sidebar.tsx` — add the "Brand" nav item (href `/brand`)
   from v2.6.0, keeping any custom nav entries.

The page ships with example playbook data at `brand/playbook.json`;
replace it with your own research export (shape documented in
`brand/playbook.schema.json`). No database or environment changes are
required.

**From 2.5.10 → 2.5.11** — the funnel dashboard learns to show more
than one funnel (selector appears once a second funnel sends events):

    git checkout v2.5.11 -- src/lib/crm/funnel.ts "src/app/api/crm/funnel/route.ts" "src/app/crm/funnel/page.tsx" VERSION CHANGELOG.md

No database or environment changes are required.

**From 2.5.9 → 2.5.11** — apply the 2.5.10 patch below, then the
2.5.10 → 2.5.11 patch above.

**From 2.5.9 → 2.5.10** — let funnels capture leads with the funnel
secret alone:

    git checkout v2.5.10 -- src/lib/crm/capture-auth.ts VERSION CHANGELOG.md

The lead capture endpoint now also accepts the `crm_funnel_secret` value
in its `x-capture-key` header, so a funnel configured with one secret can
post leads without a separate `crm_capture_key`. No database or
environment changes are required.

**From 2.5.8 → 2.5.10** — preserve calendar intent on retries, isolate
Facebook Reel metrics, and make the scheduler source explicit; afterwards
apply the 2.5.9 → 2.5.10 patch above:

    git checkout v2.5.9 -- "src/app/api/social/posts/[id]/publish/route.ts" "src/lib/social/retry.ts" "src/lib/social/retry.test.ts" "src/lib/social/meta.ts" "src/lib/social/meta.test.ts" SOCIAL.md VERSION CHANGELOG.md

Merge these three shared files rather than overwriting customizations:

1. `package.json` — add `test:social` from v2.5.9.
2. `worker.ts` — add the v2.5.9 social tick result log and
   `SOCIAL_SCHEDULER_MODE` gate. Keep any custom scheduled jobs.
3. `wrangler.jsonc` — add `"SOCIAL_SCHEDULER_MODE": "native"` under `vars`;
   keep the member's worker name, routes, bindings, and other variables.

Run `npm run test:social`, lint, and a production build. Existing v2.5.8
deployments already use the native Cloudflare cron and should remain in
`native` mode. If a customized deployment still has a recurring GitHub social
tick, deploy once with `external`, remove that GitHub schedule, then change to
`native` and redeploy. No database changes are required.

**From 2.5.7 → 2.5.10** — remove the legacy version labels, then apply the
2.5.8 → 2.5.10 steps above:

    git checkout v2.5.8 -- "src/app/content/[slug]/page.tsx" "src/app/content/page.tsx" "src/app/login/page.tsx" "src/components/sidebar.tsx" VERSION CHANGELOG.md

No database or environment changes are required.

**From 2.5.6 → 2.5.10** — take the 2.5.7 lead views, calendar sync, and
build fix, the 2.5.8 files below, then apply the 2.5.8 → 2.5.10 steps above:

    git checkout v2.5.7 -- "src/app/api/content-calendar/[id]/route.ts" "src/app/api/crm/leads/route.ts" "src/app/crm/leads/page.tsx" worker.ts VERSION CHANGELOG.md
    git checkout v2.5.8 -- "src/app/content/[slug]/page.tsx" "src/app/content/page.tsx" "src/app/login/page.tsx" "src/components/sidebar.tsx" VERSION CHANGELOG.md

No database or environment changes are required.

**From 2.5.5 or lower** — follow your chain below to reach 2.5.6, then
apply the 2.5.7, 2.5.8, 2.5.9, and 2.5.10 steps above.

**From 2.5.5 → 2.5.6** — take the concurrent publishing engine directly:

    git checkout v2.5.6 -- "src/lib/social/publisher.ts" "src/app/api/social/tick/route.ts" "scripts/social-post.mjs" VERSION CHANGELOG.md

No database or environment changes are required.

**From 2.5.4 → 2.5.6** — take the quality-ceiling adjustment, then the 2.5.6 files above:

    git checkout v2.5.5 -- "scripts/social-post.mjs" "src/app/social/page.tsx" VERSION CHANGELOG.md
    git checkout v2.5.6 -- "src/lib/social/publisher.ts" "src/app/api/social/tick/route.ts" "scripts/social-post.mjs" VERSION CHANGELOG.md

No database or environment changes are required.

**From 2.5.3 → 2.5.6** — take the hardened video-publishing files, then the patches above:

    git checkout v2.5.4 -- "scripts/social-post.mjs" "src/app/social/page.tsx" "src/lib/social/publisher.ts" "src/lib/social/types.ts" "src/lib/social/youtube.ts" "src/lib/social/youtube.test.ts" VERSION CHANGELOG.md

No database or environment changes are required. The optional test command is
`node --experimental-strip-types --test src/lib/social/youtube.test.ts`.

**From 2.5.2 → 2.5.6** — take the 2.5.3 files, then the patches above:

    git checkout v2.5.3 -- "src/lib/social/meta.ts" "src/lib/social/metrics.ts" "src/lib/social/publisher.ts" "src/app/api/social/tick/route.ts" SOCIAL.md VERSION CHANGELOG.md

**From 2.5.1 → 2.5.6** — add the 2.5.2 studio file, then every patch above:

    git checkout v2.5.2 -- "src/app/social/page.tsx"
    git checkout v2.5.3 -- "src/lib/social/meta.ts" "src/lib/social/metrics.ts" "src/lib/social/publisher.ts" "src/app/api/social/tick/route.ts" SOCIAL.md VERSION CHANGELOG.md

**From 2.5.0 → 2.5.6** — apply the 2.5.1 files first, then every patch above:

    git checkout v2.5.1 -- "src/app/api/social/accounts/route.ts" "src/app/social/accounts/page.tsx"
    git checkout v2.5.2 -- "src/app/social/page.tsx"
    git checkout v2.5.3 -- "src/lib/social/meta.ts" "src/lib/social/metrics.ts" "src/lib/social/publisher.ts" "src/app/api/social/tick/route.ts" SOCIAL.md VERSION CHANGELOG.md

If the member has customized any of these files, merge instead of
overwrite. Then build, verify the social studio loads, and deploy.
No database changes in these patches.

**After upgrading to 2.5.6, check your Meta token scopes.** If Instagram
reach/views/saves read zero while likes record fine, the token is missing
`instagram_manage_insights` — re-mint it with that permission ticked
(SOCIAL.md step 4) and reconnect.
