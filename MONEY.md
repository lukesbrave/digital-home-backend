# Money and fulfilment — Starter 3.0 candidate

`/crm/money` groups products, orders, invoices, projects and deliverables in the
member's own Home. Migration 006 is additive; existing table-name collisions stop
for a reviewed adoption. Payouts have a schema only; no automatic transfers.

Money records can be managed without Stripe. Hosted checkout and invoice sending
require the member's STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET, configured
through their existing secure setup. No credentials are supplied by this starter.
`/api/webhooks/stripe` verifies the raw body signature, claims provider events,
retries failed processing and deduplicates deliveries. Test events do not affect
a live Home unless explicitly allowed. Local tests use synthetic signatures and
fake Stripe transport; an actual Stripe test-account rehearsal is still required.

Owner-requested `/api/crm/fulfilment` POST `{action:"seed"}` adds missing onboarding,
project-stage and delivery-review recipes as drafts. Repeating setup preserves
existing email copy, workflow steps/status and onboarding selection. Nothing is
automatically enabled. Existing CRM safe mode continues to simulate email.
Winning a deal creates at most one project. Completing all deliverables adds the
`delivered` tag while retaining other tags. Project names are snapshotted into
workflow context for emails, without overwriting the lead's custom fields.

Route scopes are in `/api/home/guide`. Checkout-only keys cannot read Money or
send invoices. Approval advice in the guide is an agent instruction, not a new
server-side approval queue; the approvals/MCP port remains separate work.
