# Upgrading your Digital Home Backend

This guide is written to be executed by **Claude Code inside your own
backend project**. Paste this into Claude Code from your backend project
folder:

> Fetch https://raw.githubusercontent.com/lukesbrave/digital-home-backend/main/UPGRADE.md
> and upgrade my backend to the latest version. My project may be
> customized — preserve my changes while applying the upgrade.

---

## Scripted upgrades (from the first release after 2.9.0)

Available from the first release after 2.9.0 (not yet tagged). Until then
follow the 2.9.0 section below. Once that release is out, its own section
below names its tag; use that tag wherever this section says `<target tag>`.

**Each upgrade runs the Home's current copy of the tools,** so the first step
of every upgrade is to take the target release's copy and commit it on the
upgrade branch (`upgrade.mjs` stops and prints these commands if it finds an
older copy):

```bash
git remote add starter https://github.com/lukesbrave/digital-home-backend.git
git fetch starter --tags
git checkout -b upgrade/<target tag>
git checkout <target tag> -- scripts/upgrade.mjs scripts/lib scripts/migrations-status.mjs scripts/migrations-seed.mjs supabase/migrations/003_schema_migrations.sql
git commit -m "Bring in the upgrade tools from <target tag>"
```

Skip the `remote add` if `starter` already exists. Then:

1. `node scripts/upgrade.mjs --dry-run` shows every step and writes nothing
   (no tag, branch, file or database change).
2. Read the Supabase project ref it prints aloud and have the member confirm it
   is theirs. Never pass a ref that was not confirmed.
3. A Home without a migration history records what it already has, once:
   `node scripts/migrations-status.mjs`, then
   `node scripts/migrations-seed.mjs --project-ref <ref> --yes`.
   Add `--frontend <path>` to both so the frontend's migrations are recorded
   too, and `--dry-run` to the seed to see its rows without writing them.
4. `node scripts/upgrade.mjs --project-ref <ref> --yes --frontend <path>`. It
   works on branch `upgrade/<target tag>`, checks out and commits the files
   that are new in the release, lists every changed file to merge by hand with
   its `git diff` command, applies every pending backend migration of the
   release one transaction each and records it in `schema_migrations`, copies
   `src/types/database.ts` to the frontend when that checkout is clean and on
   its own branch, and writes `VERSION`. Without `--project-ref <ref> --yes`
   it stops at the database (exit 2) and prints the command to resume.
   `--take-untouched` also takes changed files the Home has never edited since
   its last release.
5. Merge the listed files (merge, don't overwrite), then run the checks it
   prints (`npx tsc --noEmit`, `npm run build`) and commit on the branch.
   Commit the copied types in the frontend on its branch.

The scripts read `SUPABASE_URL` from the repo's `.env.local` (a worktree uses
the main checkout's). The database password comes from `SUPABASE_DB_PASSWORD`
in the environment, from stdin with `--password-stdin`, or from a hidden
prompt; never type it into the command. Certificates are verified: download
the CA certificate from Supabase (Project Settings → Database → SSL
Configuration) and set `SUPABASE_CA_CERT=/path/to/prod-ca-2021.crt`. Each
migration waits at most 5 seconds for a lock and 60 seconds per statement
(`MIGRATION_LOCK_TIMEOUT`, `MIGRATION_STATEMENT_TIMEOUT`); a migration that
times out is rolled back. The scripts never deploy, merge the branch or delete
a file. Deploy afterwards with the member's approval (DEPLOYMENT.md).

### Partly applied migrations

`partial` means some of what a migration creates exists and some does not, and
nothing records it. The upgrade refuses to apply anything while one of the
backend's own starter migrations is partial; a partial frontend or member
migration is reported and left alone. To resolve one: compare the file with the
database (the status names what is missing). If the file is written to be
re-run (`if not exists` throughout, as `002_crm_core.sql` is), apply it again
with `scripts/apply-migration.mjs` after confirming the ref, then run the seed
to record it. Otherwise create only the missing objects by hand from the file,
then seed. Never drop what exists to start over.

### Your own migrations

Numbers `001` to `899` are reserved for this starter and the frontend starter.
Give your own migrations a number `900` or higher (for example
`900_my_feature.sql`) and never reuse or renumber a starter file: the upgrade
applies and records starter files by name, and a reused number would make it
skip or misapply one. The tools read files named `NNN_name.sql` and list any
other `.sql` file they ignore.

---

## Instructions for Claude

You are upgrading a member's Digital Home backend — a customized fork of
`digital-home-backend`. Work inside THEIR project. Their
customizations are intentional: **merge, don't overwrite.** When a file
conflicts, prefer their copy design-wise and add the new capability into it.

### Latest release: 2.9.0 — required public image storage

Read VERSION before changing anything. If it is 2.9.0, no code upgrade is
needed. If it is 2.8.0 or the tested 2.9.0 beta, follow this section and stop;
do not run the older full-install instructions below. For earlier releases,
apply the historical steps through 2.8.0 first, then this section.

1. Confirm the member's backend, frontend, Supabase project and Cloudflare
   account from their existing project context. Preserve uncommitted work and
   make a backup/upgrade worktree under `.worktrees/` on a `codex/` branch.
   Keep custom code, identity, domains, secrets, brand data and social choices.
2. Fetch the starter release tag `v2.9.0`. Review the release diff against
   `v2.8.0`, then merge the media modules and routes, article writing and
   publication guards, `worker.ts`, middleware, media check scripts and binding
   types into the member's code. Do not replace their project with the starter.
   The beta has the same runtime implementation; its remaining changes are docs
   and release metadata. No new database migration is needed for this release.
3. Follow MEDIA.md for a reviewed cutover. Activate R2 at the existing setup
   step if needed, provision a member-owned public bucket, and add `PUBLIC_MEDIA`
   and `IMAGES` while retaining all existing bindings. Do not remove
   `SOCIAL_MEDIA` or change `SOCIAL_PUBLISHING_ENABLED`. Save/verify the member's
   article image mode; an absent mode is not consent to automatic generation.
4. Inventory existing hero, body, SEO and site image references, record their
   previous URLs for rollback, and keep the original objects. The new backend
   blocks newly publishing automatic-image drafts whose heroes still use the
   legacy path. Do not cut over an active publishing workflow without reviewing
   those drafts and the separately deployed frontend's publishing routes.
   A code update alone does not migrate images or update the frontend.
5. Before production cutover, run the media/route regression scripts and build
   with the real public build variables. Verify a scoped test deployment's
   signed media probe and external image retrieval. Under the member's rollout
   approval, deploy, verify again and migrate approved references only after
   checking each new URL. Check login, one existing article/social preview,
   lead capture and the preserved social state. Set VERSION to 2.9.0 when the
   upgrade and required configuration are complete.

Useful checks from the backend folder:

```bash
node scripts/test-public-media.mjs
node scripts/test-article-media.mjs
node scripts/test-media-probe.mjs
node scripts/test-social-feature.mjs
npx tsc --noEmit
npm run build
node --env-file=.env.local scripts/check-public-media.mjs --base https://YOUR_BACKEND
```

If a cutover check fails, retain the draft and original objects, restore the
previous deployment/configuration and restore only URLs changed in this cutover
from the saved mapping. Never delete legacy storage as part of an upgrade.

## Historical upgrades through 2.8.0

The following instructions apply only to older Homes. Once they reach 2.8.0,
return to the 2.9.0 section above.

### Previous release: 2.8.0 — optional social calendar

For a 2.7.4 Home, merge these additions on an upgrade branch: `src/lib/social/feature.ts`,
`src/lib/social/feature.test.ts`, `src/app/social/layout.tsx`, the social API guard
in `src/middleware.ts` and `worker.ts`, and the optional bindings in
`cloudflare-env.d.ts`. Preserve custom auth, layouts and scheduled jobs.
Read the new `SOCIAL.md` activation/disable instructions. **Do not replace a
member's wrangler.jsonc with the starter:** that would change their identity,
URLs and social choice. Leave the new flag absent or set it to `"true"` for an
existing enabled calendar, preserving R2 and queued posts. Only set it to
`"false"` if the member chooses to disable it. No migration or new secret.
Run social/CRM/brand tests, lint and build; deploy only with member authorisation,
then verify the chosen calendar state and CRM. Update VERSION to 2.8.0 after
applying the release. Earlier versions follow their existing patches first,
then apply this 2.7.4 → 2.8.0 step last.

### Step 0 — Determine current version
- If a `VERSION` file exists, read it. If it says `2.8.0`, return to the 2.9.0
  section above. If it says anything from `2.5.0` through `2.7.4`, apply ONLY the
  "Patch upgrades" section at the bottom of this guide.
- No `VERSION` file = v1.x (content pipeline era). Apply the full v2.5.0
  upgrade below.
- Confirm this is really the backend (has `src/app/api/write-article/` or
  similar) and NOT the frontend. If it's the frontend, stop and say so.

### Step 1 — Preflight
1. `git status` — if there are uncommitted changes, commit or stash them
   first so the upgrade is revertible.
2. Create a branch named for the release you are moving to, for example
   `git checkout -b upgrade/v2.9.0`.
3. Add the starter as a remote if missing:
   `git remote add starter https://github.com/lukesbrave/digital-home-backend.git`
   then `git fetch starter --tags`.

### Step 2 — Bring in the latest version
1. Diff `git diff HEAD..v2.8.0 --stat` to see scope.
2. New files (the vast majority) can be checked out directly:
   `git checkout v2.8.0 -- <path>` for: `src/lib/crm/`, `src/lib/social/`,
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
3. **Frontend pairing:** copy `src/types/database.ts` byte-identical into
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
5. Commit, merge the branch, deploy. `VERSION` should read `2.8.0` (it
   comes along with the checkout). Then apply the 2.9.0 section at the top
   of this guide; the upgrade is done when `VERSION` reads `2.9.0`.

### If something breaks
Revert is always available: `git checkout main` (the upgrade lives on its
branch until merged). The migration is additive and safe to leave applied.

## Patch upgrades (you're already on 2.5.x)

Fetch the starter remote first: `git fetch starter --tags`.

**From 2.7.3 → 2.7.4** — keep agent worktrees inside the repo:

    git checkout v2.7.4 -- VERSION CHANGELOG.md AGENTS.md .gitignore

If `.gitignore` has local additions, keep them and only make sure it contains a
`.worktrees/` line. Then add `@AGENTS.md` as the first line of `CLAUDE.md` if it
is not already there; do not otherwise touch `CLAUDE.md`. Nothing to build or
migrate, and no new secret.

**From 2.7.2 → 2.7.3** — clarify the article workspace and published view:

    git checkout v2.7.3 -- VERSION CHANGELOG.md scripts/test-articles-ui-contract.mjs

Merge `src/components/sidebar.tsx` by changing only the existing `/content`
navigation label from `Content` to `Articles`. Merge `src/app/content/page.tsx`
by renaming its list view to `Published`, requesting
`/api/articles?status=published`, and reserving title space for the `New`
badge. Preserve the `/content` route, Pipeline columns, status transitions,
article actions, and any member-specific styling. Then run
`node scripts/test-articles-ui-contract.mjs`, `npx tsc --noEmit`, and
`npm run build`.

No database migration or new secret is required.

**From 2.7.1 → 2.7.2** — make a published Playbook feed downstream AI:

    git checkout v2.7.2 -- src/app/api/brand/playbooks/route.ts src/lib/brand/playbook-contract.ts src/lib/brand/playbook-store.ts src/lib/brand/playbook-store.test.ts scripts/publish-brand-playbook.mjs VERSION CHANGELOG.md DEPLOYMENT.md

Merge `src/app/api/write-article/route.ts` by hand so any customized writer is
preserved while adding the core Playbook projection preflight and the separate
operational offers/CTA readiness behavior. Then run `npm run test:brand`,
`npx tsc --noEmit`, and `npm run build`.

No database migration or new secret is required. Deploy, verify the scoped
route, then repair an already-live Playbook projection idempotently:

    node scripts/publish-brand-playbook.mjs check --base https://backend.yourdomain.com
    node scripts/publish-brand-playbook.mjs sync --base https://backend.yourdomain.com --actor tumi

The `sync` command owns only the seven `playbook_*` projection rows. It must not
replace `cta/links`, `identity/author`, `content/image_style`, offers, or other
human-configured operational data.

**From 2.6.0 or 2.7.0 → 2.7.1** — make the Brand shelf live-publishable:

    git checkout v2.7.1 -- src/app/brand/ src/app/api/brand/ src/lib/brand/ scripts/publish-brand-playbook.mjs brand/playbooks/index.ts brand/playbook.schema.json VERSION CHANGELOG.md

**Do NOT check out `brand/playbook.json`.** It is the member's portable source
copy and must be preserved. Merge `package.json` by adding `test:brand`, then
run `npm run test:brand`, `npx tsc --noEmit`, and `npm run build`.

No database migration or new secret is required. The live shelf uses the
existing `backend_settings` table and signed `API_SECRET_KEY` machine auth.
Keep that key in ignored `.env.local`, deploy, then verify the door:

    node scripts/publish-brand-playbook.mjs check --base https://backend.yourdomain.com

If the member already has a populated `brand/playbook.json`, publish it once
after deployment. The first live publish preserves a different bundled
edition as an archive, and `/brand/current` becomes the verified readable
copy.

**From 2.5.x → 2.6.0** — add the brand playbook page (do any patch steps
for your version below first, then this):

    git checkout v2.6.0 -- src/app/brand/ src/components/brand/ brand/playbooks/ brand/playbook.schema.json VERSION CHANGELOG.md

**Do NOT check out `brand/playbook.json`.** If you already have one it
holds your brand research, and v2.6.0's copy is an empty file that would
overwrite it. Only take it if the file does not exist in your project:

    test -f brand/playbook.json || git checkout v2.6.0 -- brand/playbook.json

Merge one shared file rather than overwriting customizations:

1. `src/components/sidebar.tsx` — add the "Brand" nav item (href `/brand`)
   and change the visible wordmark to "Digital Home" from v2.6.0, keeping
   any custom nav entries.

The page starts empty and fills itself in when your brand strategist runs
your research and writes `brand/playbook.json` (shape documented in
`brand/playbook.schema.json`). If you already have research there, it
appears as soon as you deploy. No database or environment changes are
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
