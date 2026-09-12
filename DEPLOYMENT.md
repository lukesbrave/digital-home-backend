# Deployment Guide

This guide covers deploying the Digital Home Backend Starter to Cloudflare Workers using OpenNext and the required R2/Images bindings.

## Important: OpenNext, Not next-on-pages

This project uses **@opennextjs/cloudflare** (OpenNext) to run Next.js on Cloudflare Workers. The older `@cloudflare/next-on-pages` adapter is **deprecated** and incompatible with this setup. If you see references to `next-on-pages` in tutorials or docs, ignore them — the two systems want opposite things.

---

## Prerequisites

- Node.js 22+
- A Cloudflare account
- A Supabase project with the required tables
- GitHub repository with the code pushed

---

## Step 1: Supabase Setup

Apply the frontend starter migrations first, then every migration in this
repo's `supabase/migrations/`, in order, to the same verified Supabase project.
Check each result before continuing. The frontend does not need to be deployed yet.

## Step 2: Create Admin User

This email and password are your login to the private Digital Home dashboard,
where you manage content, leads and your business. Supabase handles that login;
it is separate from your Supabase account or database password. Keep the password
in your own password manager. An agent can promote your email/UUID without it.
There is no public signup. Create your admin user manually:

1. Go to Supabase Dashboard
2. Navigate to Authentication > Users > Add User
3. Enter your email and a strong password
4. Check **Auto-confirm user** and create the account.
5. Verify the intended email/UUID and grant admin access using the supported
   admin script. Keep the chosen password private. Test sign-in after deployment.

## Step 3: Activate and configure R2

Keep this at the demo's existing point, after the database and admin-login step:

“One quick thing before the build runs — R2 (Cloudflare's storage for social
media files and article images) needs to be enabled on your account.”

Guide dash.cloudflare.com → R2 Object Storage → Purchase R2 Plan, then have the
member confirm completion. The member handles billing consent. If R2 is already
active, verify and continue. Follow MEDIA.md to provision `PUBLIC_MEDIA` and the
existing `IMAGES` binding before deploying. This is required with social off too.

## Step 4: Environment Variables

There are two types of environment variables. Getting this wrong is the most common deployment issue.

### Public variables (baked into JavaScript at build time)

Supply real values in ignored `.env.local` before the local build, or in the CI build environment for Git builds. Also configure `wrangler.jsonc` runtime `vars`. Placeholder values and runtime-only configuration do not produce a working browser login:

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `NEXT_PUBLIC_DIGITAL_HOME_URL` | Public frontend URL used by dashboard links |

These are safe to expose — they are restricted by Row Level Security.

### Server-side secrets (must be set via Wrangler CLI)

Use `wrangler secret put` with protected input to install Worker secrets for
this workflow. Keep required local copies only in ignored, owner-only files;
never put actual values in command arguments, logs or committed configuration.
Runtime public values such as `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
`DIGITAL_HOME_URL` belong in `wrangler.jsonc` vars. The service-role and shared
API secrets remain private. Add provider keys only when that feature is chosen.

| Secret | Description |
|--------|-------------|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (bypasses RLS) |
| `SUPABASE_ANON_KEY` | Duplicate of the anon key for server-side access |
| `API_SECRET_KEY` | Shared secret between Frontend and Backend (must match both) |
| `ANTHROPIC_API_KEY` | Anthropic API key for AI article writing |
| `OPENAI_API_KEY` | OpenAI API key for hero images |
| `DIGITAL_HOME_URL` | Your public frontend URL (e.g., `https://yourdomain.com`) |

Secrets set via Wrangler take effect immediately — no rebuild needed.

Optional non-secret runtime vars:

| Variable | Description |
|----------|-------------|
| `API_SIGNATURE_REQUIRED` | Leave as `true` for public deployments unless you intentionally need unsigned machine requests during a migration. |
| `API_REQUEST_SIGNATURE_TTL_SECONDS` | Optional max age for signed machine requests. Default is `300`. |
| `OPENAI_IMAGE_MODEL` | Optional hero-image model override. Defaults to `gpt-image-1`. |

Keep the same `API_SECRET_KEY` in the project's ignored `.env.local` so
approved agent-owned updates can use the signed, scoped publishers. After
deployment, verify the Brand door before research begins:

```bash
node scripts/publish-brand-playbook.mjs check --base https://backend.yourdomain.com
```

This check does not publish a playbook. It proves authentication, the live
Brand shelf, the downstream Playbook projection state, and operational
offer/CTA readiness. Missing operational CTA data is reported separately from
core brand readiness.

Publishing an approved Playbook writes both the readable shelf and its
deterministic `brand_context` projection. For an existing Home that already
has a live Playbook but predates that projection, use the safe idempotent
backfill:

```bash
node scripts/publish-brand-playbook.mjs sync --base https://backend.yourdomain.com --actor tumi
```

`sync` reads the current Playbook through the signed route and repairs only
the publisher-owned `playbook_*` context rows. It does not archive an identical
edition or overwrite `cta/links`, `identity/author`, `content/image_style`, or
other independently configured rows.

## Step 5: Deploy to Cloudflare

1. Configure `wrangler.jsonc` locally with your non-secret runtime vars
   - replace the starter Worker name
   - replace `WORKER_SELF_REFERENCE.service` so it matches that Worker name
   - configure required `PUBLIC_MEDIA` per `MEDIA.md`; social opt-out omits only
     the separate `SOCIAL_MEDIA` binding, never public image storage
   - set `FRONTEND_WORKER` to the actual frontend Worker. If it does not exist
     yet, omit that binding for the first deploy, then add it once the frontend
     has deployed. Preserve the self-reference binding.
2. Build and deploy once: `npm run deploy`.
3. If an unchanged build already passed with `npm run build`, deploy that output
   with `npx opennextjs-cloudflare deploy` instead of building it a second time.
4. Set the required Worker secrets with `wrangler secret put`

After deployment, pin the verified backend `/media` URL as `PUBLIC_MEDIA_BASE`
and run `node --env-file=.env.local scripts/check-public-media.mjs --base <backend>`.
Verify dashboard login, deploy/connect the frontend and prove its lead loop.
Do not call setup complete if the external media probe fails. Keep existing
Supabase buckets and references intact until a reviewed migration is verified.

## Later content work: Seed Operational Brand Context

The Playbook publisher owns durable audience, positioning, voice, rules,
never-say, proof, and offer-core rows. Use the setup endpoint only for
independent operational rows such as CTA destinations, author identity, and
image style. Never invent a price, checkout URL, testimonial, or active offer
to make this step look complete.

After deploying, log into the backend and call the authenticated setup endpoint from that session, or insert those approved operational rows directly in Supabase:

`POST https://your-backend-url/api/setup`

## Step 7: Custom Domain (Optional)

In Cloudflare > your project > Custom Domains > Add Domain. Point `backend.yourdomain.com` to the worker.

---

## Other hosting platforms

This release's supported deployment uses Cloudflare Workers, R2 and Images.
Another host requires a separately implemented and verified media adapter;
importing this starter into another platform is not a complete deployment.

---

## Lessons Learned

These are hard-won lessons from the initial deployment. Read these before debugging a failed build.

### Build command must be `npm run build`

Do **not** use `npx @cloudflare/next-on-pages@1` as the build command. That is the old adapter. `npm run build` runs the OpenNext build pipeline. Deploy its unchanged output with `npx opennextjs-cloudflare deploy`; `npm run deploy` performs both steps.

### Do NOT add edge runtime exports

Do **not** add `export const runtime = 'edge'` to your route files. OpenNext handles runtime configuration itself. The old `@cloudflare/next-on-pages` required these exports, but OpenNext **rejects** them. If you see this pattern in old Cloudflare tutorials, skip it.

### TypeScript errors only surface in production builds

`next dev` (local development) does not catch all type errors. `next build` (production) does. Always run `npm run build` locally before pushing to catch errors early.

### Build artifacts do not belong in git

The `.vercel/output` directory is a build artifact created during the build process. These directories should all be in `.gitignore`:

```
.vercel/
.open-next/
.wrangler/
```

### New Supabase tables must be in the types file

If you add a new table to Supabase but do not add it to `src/types/database.ts`, the Cloudflare production build will fail with TypeScript errors. Either add the table to the types file or use a type assertion:

```typescript
.from("table_name" as any)
```

---

## Troubleshooting

### "routes were not configured to run with the Edge Runtime"

You are using the old `@cloudflare/next-on-pages` build command. Change the build command to `npm run build`.

### "cannot use the edge runtime" (OpenNext error)

Remove `export const runtime = 'edge'` from all route files. OpenNext handles runtime assignment and does not accept manual edge runtime exports.

### TypeScript errors during Cloudflare build

Run `npm run build` locally to reproduce and fix the errors before pushing. Common causes:

- **New tables not in `database.ts` types** — add the table definition or use a type assertion
- **String parameters not matching union types** — add an `as Type` assertion

### Build artifacts committed to git

If `.vercel/`, `.open-next/`, or `.wrangler/` directories were committed, remove them:

```bash
git rm -r --cached .vercel .open-next .wrangler
echo ".vercel/" >> .gitignore
echo ".open-next/" >> .gitignore
echo ".wrangler/" >> .gitignore
git add .gitignore
git commit -m "Remove build artifacts and update gitignore"
```
