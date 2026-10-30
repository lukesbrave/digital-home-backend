# Starter 3.0 development status — 2026-10-30

Not released. Branch `codex/starter-3-2026-10-30` in both starter repositories.
Backend base 1a4b18b, frontend base 257dfe3. Existing public versions remain
backend 2.9.0 and frontend 2.5.4. No production changes or migrations performed.

## Implemented foundation

- Existing-Simon task guide: no rehire, card update or training installation.
- Capture/verify of customised code (including deleted files and file modes),
  with exact after-hash approvals for intentional reviewed merges.
- Upgrade safety: no premature VERSION bump; refuse unexpected source remote
  and inconsistent target VERSION. Current database confirmation gates retained.
- Analytics shell: client website/page event counts plus existing funnel report;
  redirects preserve old funnel URLs and parameters. Query filters on legacy
  URLs are retained; only the existing funnel API's supported filters are applied.
- Authenticated Home discovery reads actual migration history and reports unknown
  state honestly. Guide and capabilities explicitly identify this limited stage.
- Frontend companion instructions preserve the existing site and tracking choices.

## Second increment — keys, events, Money and fulfilment

- Optional hashed/scoped agent keys; central fail-closed route checks. Legacy
  authentication preserved, with actual-module tests using old signed requests.
- Events feed/stats and lead/activity/article/key receipts. Payment processing
  receipts are atomic with webhook completion; ignored/replayed events do not
  duplicate receipts. This is processing evidence, not revenue analytics.
- Money page/API for products, orders, invoices, projects and deliverables;
  Stripe signature/retry/idempotency handling and optional checkout.
- Won-deal project hooks and draft fulfilment recipes. Reseeding preserves member
  email copy, workflow steps/status and onboarding settings.
- Numbered backend migrations 004–007; table-name collisions stop rather than
  adopt or replace member tables. Shared types synced to the frontend candidate.
- Expanded guide distinguishes code capabilities from actual schema history.
  Scoped access outside its documented route set is deliberately unavailable.

## Third increment — recovery and unchanged-Simon compatibility

- A real PostgreSQL dump/restore rehearsal now runs against a disposable private
  Unix-socket cluster (no TCP listener, production credentials or live services).
  It restores full custom schema, values, permissions, sequences, code bundles,
  deleted pages/executable modes and local media/configuration fixtures.
- Interrupted migrations, corrupt artifacts, nonempty restore targets, linked
  files and receipt overwrite attempts have explicit failure checks.
- Private artifact integrity tool compares bytes, permissions, directories and
  unexpected/missing files; it is not itself a backup or completeness proof.
- Fixed a real upgrade hazard: a clean frontend could contain committed custom
  types. The upgrader now leaves differing frontend types untouched and requests
  a reviewed merge instead of automatically copying over them.
- RECOVERY-3.md is linked from the existing-Simon guide. Historical Simon source
  from published Auto Agency db138ee3 was inspected (skills 2026-10-02.2): it
  already follows release UPGRADE.md. Hashes and acceptance steps are recorded in
  OLD-SIMON-REHEARSAL.md; no card/training/identity/memory was changed.
- Actual guided old-Simon local rehearsal now PASS: archived September Simon used
  unchanged training (76 files), real Buzz relay/ACP and shipped upgrade tools.
  Pre/post-upgrade restores, interrupted transaction, preservation/type merge and
  negative recovery checks executed; independent outcome checks pass. Details and
  limitations are in OLD-SIMON-REHEARSAL.md. Native desktop UI remains untested.

## Proof

- Foundation/preservation: 14/14. Upgrade preparation: 37/37 (including committed frontend custom types).
- Money/fulfilment: 115/115. Keys/authentication: 20/20. Events: 38/38.
- CRM suite: 14/14 (includes fulfilment tests counted above).
- Isolated PostgreSQL (PGlite): 4/4, applying the actual original paired schema
  and new migrations; custom tables/columns/row values/workflows/settings survive,
  conflicting table names stop safely, role restrictions hold, and payment
  receipts are atomic and not duplicated on repeat completion.
- Backend production OpenNext build and TypeScript checks pass with synthetic
  public settings. No real credentials or live database were used.
- Frontend production OpenNext build passes with synthetic settings; targeted
  new-module lint is clean; broader touched-file lint has no errors and two
  pre-existing sidebar effect warnings. Frontend CRM tests: 10/10. Exact branch
  commits are in the shared plan.
- Recovery integrity tests: 3/3. Actual PostgreSQL recovery runner: 6/6 (five
  scenarios plus parent). Foundation/preservation 14/14 rerun; targeted script
  lint clean. App runtime files unchanged this increment; previous builds stand.
- PostgreSQL 18 test binaries installed locally; no system service started. The
  test creates/stops/removes only its own synthetic cluster.
- Actual older-Simon guided local runtime run passed; hosted Supabase/Stripe network canary remains.
  Auth and Storage metadata in local SQL fixtures do not prove provider login or
  hosted object recovery; local byte copies do not prove R2 API transfers.

## Remaining release work (not hidden behind a 3.0 version bump)

1. Client-neutral approvals/MCP and remaining scoped routes; finish complete
   guide, key setup UX and optional module setup UI. No private operator/Skool.
2. Full schema/type regeneration workflow that merges member columns; actual
   PostgreSQL tests are now present but not hosted Supabase or Studio proof.
3. Analytics source/device filters and remaining generic reports; current counts
   are recorded events, not unique people, verified leads or social statistics.
4. Hosted database/media/account recovery, including actual Auth login, Storage
   and R2 transfer, on an isolated target. Local full-schema/code/media recovery
   is now tested; provider recovery, post-snapshot writes and cutover remain.
5. Expand the passed local old-Simon scenario to more complex member type/schema
   customisations and fresh/customised running Home canaries, real Stripe test mode
   and optional Studio/social matrix. No training update is required for the passed scenario.
6. Review paired versions/release metadata only after the above. Public versions
   remain backend 2.9.0/frontend 2.5.4; no publication without Luke's word.

Continue in these worktrees. The main plan/readiness matrix in Auto Agency holds
cross-repo status. This increment is not a complete 3.0 release candidate.
