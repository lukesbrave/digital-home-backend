# Activity events — Starter 3.0 candidate

Migration 005 adds an owner/service-role event stream. GET `/api/events` accepts a
`since` cursor, optional `action` prefix, `lead_id` and `limit`. GET
`/api/events/stats` returns counts for 24 hours and 7 days. Scoped callers need
`events:read`. Receipts contain IDs/counts/enums, not email bodies or buyer details.

Wired emitters: lead upserts, selected CRM activity (stage changes and email
sends), article PATCH publication transitions, key mint/revoke, payment processing.
Approvals emitters and other publication paths are not yet complete. No claim of
a complete business audit trail. The feed uses a short settling delay; unusually
long transactions can become visible behind a saved cursor. It is not a durable
exactly-once event bus. Lead deletion scrubs linked receipts and reports success.

Migration 007 adds `payment.processed` when a webhook is marked processed. It is
in the same database transaction; retries do not emit again. Ignored events do
not emit. This is processing evidence, not revenue or a new-sale counter. Refunds,
trials, renewals and no-ops can all be processed. Use orders/invoices for money.
