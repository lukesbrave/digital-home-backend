# Starter 3.0 development status — 2026-10-30

Not released. Branch `codex/starter-3-2026-10-30` in both starter repositories.
Backend base 1a4b18b, frontend base 257dfe3. Existing public versions remain
backend 2.9.0 and frontend 2.5.4. No production changes or migrations performed.

## Implemented first increment

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

## Proof

- `npm run test:starter3`: 14/14 (customisation hashes/modes, dirty work refusal,
  receipt overwrite refusal, legacy URL selection, metrics and unknown history).
- `npm run test:upgrade`: 36/36 against synthetic git repositories/fake database.
  Includes no-write dry run, project gates, interrupted preparation, partial
  migrations, dirty frontend protection and source/tag mismatch refusal.
- Production OpenNext backend build with synthetic public settings; no client
  credentials, API keys, live database or deploy. See the shared plan for final
  build/lint outcome and exact branch commit.
- The real current frontend code, employee cards and installed training are not
  replaced. No real older-Simon run was performed: the guide's dependency contract
  is tested, model/runtime behaviour is still to be rehearsed.

## Remaining release work (not hidden behind a 3.0 version bump)

1. Port generic scoped auth/keys, approvals/MCP, events, money and fulfilment from
   the proven Home; exclude Luke-only Skool and private operator machinery.
2. Stable numbered migrations, prerequisite ordering, safe-mode defaults and
   complete generated types including client columns; paired frontend sync.
3. Complete client-only guide/capability inventory, optional setup UI and
   idempotent payment-event integration. Stripe test-mode proofs.
4. Analytics source/device filters and broader report portability where the
   actual client event schema supports them; current counts are recorded events,
   not unique people, verified leads or sales. No social/Search Console promises.
5. Complete database/media/account recovery procedure and verify restored values
   on an isolated target, including custom schema and legacy media. Hash receipts
   do not prove database preservation, backups or runtime behaviour.
6. Actual old-Simon rehearsal with the standalone guide, unchanged old card and
   unchanged training; no newer plugin API required. Fresh and customised-Home
   canary, optional Studio and social enabled/disabled matrix, rollback proof.
7. Review release metadata and paired versions; publication needs Luke's word.

For the next coding session: the readiness matrix is
`Auto Agency/PLANS/STARTER-3-READINESS-2026-10-30.md`. Continue in these worktrees.
Never treat this first increment or a passing unit suite as a complete 3.0 release.
