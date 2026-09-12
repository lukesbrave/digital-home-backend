# Public marketing images

R2 is required for a complete new Digital Home, even with social publishing off
or text-only articles. Supabase holds records and URLs. Public article and
website image bytes go to the member's R2, never a public Supabase bucket.
Do not change private document storage or remove legacy files during setup.

## Provision once

1. Reuse the verified Cloudflare account/session. Explain that R2 is standard
   public media infrastructure. The member completes R2 activation if the API
   returns the documented activation requirement (10042). Included free usage
   is not a spending cap; obtain the member's billing choice. Declining leaves
   the build incomplete, not a reason to silently switch images to Supabase.
2. Create a member-owned `<brand>-public-media` bucket with
   `npx wrangler r2 bucket create <brand>-public-media`. On a retry, list/check
   the existing bucket in the intended account before creating anything else.
3. Set `PUBLIC_MEDIA` in `wrangler.jsonc` to that bucket. Preserve any existing
   `SOCIAL_MEDIA` binding. Public media is independent of
   `SOCIAL_PUBLISHING_ENABLED`; do not enable social scheduling just to use R2.
4. Keep the existing `IMAGES` binding. It resizes/re-encodes images once on
   upload (not per visitor). Cloudflare Images transformations have their own
   allowance/pricing; disclose that with the provider costs and verify access
   during the probe. Do not auto-upgrade a provider plan to repair a failed check.
5. Deploy. Without `PUBLIC_MEDIA_BASE`, the application uses its own existing
   HTTPS origin plus `/media`. No custom domain or r2.dev activation is required.
   After the first deploy, pin `PUBLIC_MEDIA_BASE` to that verified backend
   `/media` URL so aliases/custom backend domains do not change saved image URLs.
   This gateway only serves `public/blog`, `public/website`, and `public/probe`
   WebP objects. It does not expose other objects, list buckets, or accept writes.
   Browser caching and Worker Cache API reduce reads; Worker requests and R2
   operations retain their provider limits/costs. R2 egress is free.
6. Optionally set `PUBLIC_MEDIA_BASE` to a verified custom domain attached to
   this public-only bucket. Configure caching and CORS for GET/HEAD. Do not
   attach a public domain to a bucket containing private files. New URLs use
   that domain; keep the old gateway available for existing URLs until migrated.

## Verify the actual path

Use `node --env-file=.env.local scripts/check-public-media.mjs --base <backend>`.
It signs the machine-only POST `/api/media/readiness`, then downloads the
returned public URL from outside the Worker and compares SHA-256, Content-Type,
cache headers and byte size. It makes no AI model call. A small deterministic
probe object stays in R2 for later checks. GET reports configuration only and
must never be described as live proof. A failed probe blocks setup handoff.
Then verify a human-approved draft hero and social-preview image in the public
frontend. Keep that distinct from the infrastructure probe. Do not generate a
paid image or publish an article without the user's existing approval.

## Images and publication

`POST /api/media/upload` accepts signed JSON `{image_base64, slug, kind}` where
kind is `blog` or `website`. It optimises to WebP, scales down to at most 1536
pixels, and enforces 500 KiB, with up to three bounded encoding attempts.
Review the actual image as part of editorial/design QA; a byte limit alone
cannot prove visual quality. Object names include their content digest and get
immutable cache headers. It does not fetch URLs or accept arbitrary R2 keys.

Automatic article imagery uses the saved OpenAI key and this same upload path.
Image-provider/storage failures preserve generated copy as a draft and return
`image_status: failed`, `image_error`, and `publication_blocked: true`. Repair
the existing draft using `/api/media/upload` and update its hero and SEO image;
do not rewrite a paid article just to fix its image. Text-only mode skips the
image-model call. A missing saved mode is a setup fault, not implied consent.

## Existing Homes

This release does not automatically migrate clients or delete legacy files.
Before upgrading: provision/probe R2, record the existing approved image mode,
inventory article hero, body image, SEO image and site asset references, and
save a rollback mapping. Upload optimised copies through the supported media
endpoint; update the existing records and site references only after verifying
each new URL. Keep IDs/slugs/calendar links and old objects intact. Verify the
public pages and social previews. The publication guard will require a legacy
hero to be migrated before a draft can be newly published. Audit direct
frontend publishing routes as part of cutover; upgrading only this backend
does not enforce policy in independently deployed frontend code.
