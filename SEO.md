# SEO Agent (Search Console sync)

`seo_meta` has four columns marked "Performance (updated by SEO Agent)":
`current_rank`, `impressions_30d`, `clicks_30d`, `ctr_30d`. Until this is
configured, nothing writes to them — no SEO Agent exists without it, and
every page's ranking data sits empty.

This fills them in with real Google Search Console numbers. No login
prompts, no third-party tool, no cost — it runs on a Google Cloud service
account added as a read-only user on your Search Console property.

## Why this has to happen before launch, not after

Search Console only has data from the day a property is verified onward.
It never backfills. A Digital Home that goes live without this connected
is losing a baseline it can never get back — do this during setup, not as
a later improvement.

## One-time setup

1. **Create a Google Cloud project** (console.cloud.google.com) if you
   don't already have one for this business.
2. **Enable the Search Console API** — APIs & Services → Library → search
   "Search Console API" → Enable.
3. **Create a service account** — APIs & Services → Credentials → Create
   Credentials → Service account. Name it anything (e.g. `seo-agent`).
4. **Create a JSON key** for that service account — Keys tab → Add Key →
   Create new key → JSON. This downloads a file containing `client_email`
   and `private_key`. Those two fields are all this needs.
5. **Verify the property in Search Console** (search.google.com/search-console)
   if it isn't already — domain property or URL-prefix, either works.
6. **Add the service account as a user** — Search Console → Settings →
   Users and permissions → Add user → paste the service account's
   `client_email` → permission level **Restricted** (read-only is all the
   sync needs).

## Worker secrets

```bash
echo "the-service-account@project.iam.gserviceaccount.com" | npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_EMAIL
echo "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n" | npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
echo "https://www.yourdomain.com/" | npx wrangler secret put GOOGLE_SEARCH_CONSOLE_SITE_URL
```

`GOOGLE_SEARCH_CONSOLE_SITE_URL` must match the property exactly as it
appears in Search Console — a URL-prefix property needs the trailing
slash (`https://www.yourdomain.com/`); a domain property uses the
`sc-domain:yourdomain.com` form instead. Paste the `private_key` field
from the JSON key exactly as downloaded, including the `\n` sequences —
the route un-escapes them before use.

## Running it

```bash
curl --fail-with-body -X POST "https://backend.yourdomain.com/api/seo/sync-rankings" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_SECRET_KEY" \
  -H "x-timestamp: $(date +%s)" \
  -H "x-signature: ..."
```

Signed the same way as every other machine route — see `write-article` or
`trend-scan` for the HMAC construction, or trigger the frontend's
`weekly-seo-sync.yml` GitHub Action instead of hand-signing requests.

Each run pulls the trailing 28 days of Search Console data (ending 3 days
back, since Search Console itself reports with a 2-3 day lag), matches
each returned page URL against `seo_meta.canonical_url`, and updates the
four columns on a match. The response and the `agent_logs` row both report
`pages_matched` and `unmatched_pages` — unmatched pages usually mean the
property's verified URL form doesn't match `canonical_url` (http vs https,
www vs no-www), or the page hasn't been crawled yet.

## What this does not do

This is read-only ranking data, not content strategy. Finding what to
write about next, competitor keyword gaps, and content-gap research are a
separate, optional, paid layer — not part of this sync.
