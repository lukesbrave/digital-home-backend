# Isolated hosted acceptance

These scripts are deliberately pinned to the Starter test source and recovery
projects in Brave Test. They create synthetic users, keys, CRM records and Stripe
test objects. Do not repoint them at a member Home. Private inputs live outside
git with mode 0600. Never paste keys or passwords into commands or reports.

- `scripts/test-hosted-starter3.mjs`: actual hosted password login and private
  Storage byte roundtrip, local candidate owner/MCP/approval routes and refusal
  checks. Requires the existing project key file; returns no keys.
- `scripts/test-hosted-stripe.mjs`: reads the test-only Stripe CLI profile;
  refuses a live key. Runs a local candidate and Stripe forwarding listener,
  creates a test checkout, tests signed delivery/replay/signature rejection,
  and exercises subscription renewals/failure/cancellation/refund with test clocks.
- `scripts/test-hosted-restore.mjs`: after separately restoring the provider SQL
  backup into the guarded empty target, verifies the same account can sign in,
  history/approvals recover and private Storage bytes can be transferred and
  read with the original hash. Anonymous reads must fail. It demonstrates that
  source writes after the snapshot are absent on the restored target and need
  reconciliation before cutover.

The scripts currently use explicit private receipt/configuration paths under
`/private/tmp/starter3-*`; retain encrypted recovery artifacts in owner-held storage
before any real member upgrade. Receipts in the shared plan record exact tested
scope. A Storage roundtrip is not proof of all media, and a local app connected
to a hosted database is not a Cloudflare application deployment. Never use these
checks to claim production cutover or zero loss from a stale backup.

Additional delivery-order checks are in `test-hosted-payment-ordering.mjs`
(actual provider payloads with local test HMAC, refund-before-payment retry) and
`test-hosted-payment-retry.mjs` (resume an interrupted synthetic refund after its
five-minute claim lease expires; no manual ledger edits). The latter requires
an intentionally interrupted test receipt and refuses when none exists.
Always await the webhook's processed_at receipt before stopping the local app;
an order transition alone does not prove the event completed.
