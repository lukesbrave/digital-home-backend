# Deployment Guide

This guide covers deploying the Digital Home Backend Starter to Cloudflare Workers using OpenNext, with a Vercel alternative for simpler setups.

## Important: OpenNext, Not next-on-pages

This project uses **@opennextjs/cloudflare** (OpenNext) to run Next.js on Cloudflare Workers. The older `@cloudflare/next-on-pages` adapter is **deprecated** and incompatible with this setup. If you see references to `next-on-pages` in tutorials or docs, ignore them — the two systems want opposite things.

---

## Prerequisites

- Node.js 18+
- A Cloudflare account
- A Supabase project with the required tables
- GitHub repository with the code pushed

---

## Step 1: Supabase Setup

Run the Frontend migrations first, then run this repo's migration in the Supabase SQL Editor:

```sql
-- digital-home-backend-starter/supabase/migrations/001_backend_core.sql
```

## Step 2: Create Admin User

There is no public signup. Create your admin user manually:

1. Go to Supabase Dashboard
2. Navigate to Authentication > Users > Add User
3. Enter your email and a strong password
4. Check **Auto-confirm user**

## Step 3: Deploy to Cloudflare

1. Configure `wrangler.jsonc` locally with your non-secret runtime vars
   - replace the starter Worker name
   - replace `WORKER_SELF_REFERENCE.service` so it matches that Worker name
   - replace the R2 cache bucket name with your own unique bucket
2. Build locally:
   - **Build command:** `npm run build`
3. Deploy with the package script:
   - **Deploy command:** `npm run deploy`
4. Set the required Worker secrets with `wrangler secret put`

## Step 4: Environment Variables

There are two types of environment variables. Getting this wrong is the most common deployment issue.

### Public variables (baked into JavaScript at build time)

These go in the Cloudflare dashboard (Settings > Variables & Secrets) AND in `wrangler.jsonc` under `vars`:

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `NEXT_PUBLIC_DIGITAL_HOME_URL` | Public frontend URL used by dashboard links |

These are safe to expose — they are restricted by Row Level Security.

### Server-side secrets (must be set via Wrangler CLI)

These MUST be set using `wrangler secret put` from your terminal. The Cloudflare dashboard UI does NOT work for Workers — only for Pages projects. This is the most common gotcha.

```bash
echo "your-value" | npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
echo "your-value" | npx wrangler secret put SUPABASE_ANON_KEY
echo "your-value" | npx wrangler secret put SUPABASE_URL
echo "your-value" | npx wrangler secret put API_SECRET_KEY
echo "your-value" | npx wrangler secret put ANTHROPIC_API_KEY
echo "your-value" | npx wrangler secret put OPENAI_API_KEY
echo "your-value" | npx wrangler secret put DIGITAL_HOME_URL
```

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

## Step 5: Create the `images` Storage Bucket

The article writer uploads hero images into a Supabase Storage bucket named `images`.

1. Go to **Supabase > Storage**
2. Create a bucket named `images`
3. Make it **public** if you want article hero images to load directly on the public site

If you skip this, the writer still works, but image upload will fail gracefully and articles will publish without hero images.

## Step 6: Seed Operational Brand Context

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

## Vercel Alternative

If you do not need Cloudflare specifically, Vercel is simpler:

1. Import the repo at [vercel.com](https://vercel.com)
2. Add environment variables
3. Deploy

No build configuration is needed. Next.js is made by Vercel, so it works out of the box. The trade-off: Vercel is more expensive at scale and you have less infrastructure control.

---

## Lessons Learned

These are hard-won lessons from the initial deployment. Read these before debugging a failed build.

### Build command must be `npm run build`

Do **not** use `npx @cloudflare/next-on-pages@1` as the build command. That is the old adapter. Wrangler's deploy step handles the OpenNext conversion automatically after a standard Next.js build.

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
