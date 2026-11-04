# Starter 3.0 development status — 2026-10-30

**Scope change — 2026-11-04:** Luke requested no bundled Approvals screen, with
approval capability managed through agents in Buzz. Removed the page/navigation;
proposal schema/MCP and execution/audit protection remain. Queue/detail/decision
HTTP routes now accept admin sessions or the existing signed master connection;
ordinary named/scoped employee keys cannot decide. APPROVALS.md requires exact
owner confirmation in Buzz, explains immediate workflow effects, and distinguishes
credential authorization from proof of a human chat message. Member-built approval
interfaces are preserved. Final acceptance/PR receipts below predate this increment
until the new owner-control-plane tests/build are recorded.

## Current release review — 2026-11-04

The paired 3.0.0 candidate is prepared for owner publication review. Candidate
VERSION is 3.0.0 in both repos; published baselines remain backend 2.9.0 and
frontend 2.5.4 until the paired releases are approved and published.

All planned maintainer rehearsal gates now have recorded evidence: core hosted
cold install/recovery/payments/deployed browser checks, actual unchanged older
Simon scenario, and installed Studio 1.7.2 schema/data/code/runtime preservation.
Studio tests compare 15 table schemas/rows across actual Starter SQL, saved-board
snapshots across original/upgraded apps, safe/stale saves, owner/master/refusal
boundaries, complete generated schema builds, 314 custom file checks (five
reviewed merges), and built Cloudflare static/runtime boundary checks. The
member's deployment configuration and Studio-owned code remain unchanged.

Clean-dependency review found missing Studio package declarations in the old
canary, hidden by shared node_modules; the isolated specimen reconciles the
installed release requirements. Upgrade guidance now calls this out and explains
that type preparation retains old helpers but new release aliases need review.
No existing Studio runner was restarted; no model work or public deployment.

Final core validation: 297 backend tests, 10 frontend tests, both production
builds; installed-Studio paired builds and 58 module checks pass. Final release
pair inventories/hash checks match; existing official SQL is unchanged. Browser
assets contain none of the private synthetic server credentials checked.
RELEASE-3.md, RELEASE-PAIR.json and the release PRs hold the handover. Remaining
step: Luke's publication word, then promote/tag/publish the exact reviewed pair
and verify their downloadable artifacts. Each member still needs their own
recovery, reviewed merges and approved deploy. The progress notes below are
historical; their earlier pending gates/version statements are superseded here.


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
- Payment APIs for products, orders, invoices, projects and deliverables;
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

## Remaining release work (current 2026-11-03)

Hosted core cold-install, real Auth/Storage/custom-schema recovery, R2 transfer,
Stripe test lifecycle/retry/order and deployed desktop/mobile checks now pass.
Generic MCP/approvals/key UI, generated types and Analytics filters are present.
See the latest deployed acceptance section below; earlier checkpoints are historical.

1. Complete the installed Studio runtime upgrade rehearsal, preserving shared
   navigation, generated types, dependencies and configuration. Read-only planning
   against Studio 1.7.2 passes but is not a running upgraded Home test.
2. Review final fresh-build and existing-member documentation, paired immutable
   version metadata and exact release diff against recorded canary refs.
3. Obtain Luke's word for public release publication. Current versions remain
   backend 2.9.0/frontend 2.5.4. Test-site deployment approval is not a public tag.

Continue in these worktrees. The main plan/readiness matrix in Auto Agency holds
cross-repo status. This increment is not a complete 3.0 release candidate.

## 2026-11-03 scope correction

Luke approved payment capabilities without a bundled Money screen. Removed the
candidate page and navigation; APIs, schema and processing remain. Existing
member interfaces must survive upgrades. Both candidate setup guides now specify
900–999 and reviewed handling of previously applied custom migrations and types.
Release remains pending the gates above.

Validation for this change: payment 115/115, upgrade 37/37, production OpenNext
build passed. Compiled route manifest has no Money page and retains products API.
No hosted account/database tests or deployment performed in this increment.

## 2026-11-03 agent connection and release preparation

Implemented generic MCP (14 tools), owner-only Approvals and agent-key pages,
optional connection status, source/device Analytics filters and frontend event
provenance. Migration 008 creates owner-only queue/audit tables and refuses
member table collisions. Approval claims prevent duplicate execution; deal wins
use the existing fulfilment hooks. No private operator/community tools shipped.
SCHEMA-TYPES.md and review-only preparation tooling preserve member helper
aliases and flag schema members missing from generated output.

Validation: MCP/handlers/proposals/decision 63, keys 20, events 38, Money 115,
upgrade 37, foundation 15, schema types 3, SQL 5, local PostgreSQL recovery 6
pass. Paired production builds passed before final fulfilment-hook review;
TypeScript passes after it. Synthetic-provider browser rehearsal is incomplete:
login navigation timed out, so no browser acceptance is claimed.

Remaining: hosted fresh/customised Home and separate-target Auth/Storage/R2
restore; real Stripe test-mode matrix; optional Studio/social compatibility;
actual generated types from the hosted schema; final browser and production
build rerun, paired metadata and release review. Luke asked us to find an empty
project; account inventory is being checked. No deploy, database mutation,
version bump or publication performed. This is not yet release-ready.

## Hosted schema and runtime proof — 2026-11-03

Luke created test project `iotldbnwtnzpwpyhwgmo` in Brave Test. Empty-schema
preflight passed, then all 19 paired candidate migrations applied atomically.
Verified 50 public tables, 19 history entries and restricted approval/key grants.
Actual generated schema types now replace inherited optional Studio/private
table placeholders in both clean starter candidates. Member upgrade guidance
still generates from each member's full actual schema and preserves aliases.
Fixed nullable calendar/dates/activity handling and validated text status/platform
values at runtime. Both app TypeScript checks pass against generated types.

Real hosted Auth password sign-in, private Storage byte hash roundtrip and anon
denial passed. Local candidate Next runtime against hosted Supabase passed owner
session, scoped key creation, MCP discovery, article proposal/approval, duplicate
approval refusal and anonymous queue denial. Synthetic records only; fernhollow's
four leads and one user untouched. Receipt held in shared readiness evidence.
This does not prove a separate-project restore, Cloudflare deployment, R2 or
Stripe. A second empty project and Stripe account selection have been requested.

Final checks for generated-type increment: backend and frontend production OpenNext builds pass; payment 116, MCP 63 and upgrade 37 tests pass; touched backend lint clean. Hosted test harness is scripts/test-hosted-starter3.mjs, pinned to the test project.

## Hosted recovery and Stripe lifecycle — 2026-11-03

Luke deleted fernhollow and authorised the freed Brave Test slot and the connected
Stripe account. Created separate recovery target `uwgpjpudrhzkskjnlqkn`. Actual
provider schema/data dumps from the synthetic source restored transactionally.
Same synthetic account identity/password works on target; all 19 history rows,
completed approval and private Storage bytes recover, with anonymous denial.
Separate custom-schema backup/restore recovered a custom table/JSON value,
function, view, sequence and access restrictions. Occupied-target restore refuses;
trusted hashes detect a corrupted copy before restore. Post-snapshot products
remain absent on target, so no automatic cutover or zero-loss claim is made.
R2 synthetic bytes match after real source-bucket export/target-bucket restore.

BraveBrand LLC test-only credentials: real checkout API and signed Stripe CLI
delivery pass. Test clocks prove subscription payment, renewal, failed renewal,
cancellation and refund. Strengthened the harness to await processed_at, not just
order status. A deliberately interrupted refund refused replay during its live
claim and resumed after the five-minute lease without ledger edits. Actual
provider payloads delivered refund-before-checkout fail retriably, release the
claim, and settle on retry after checkout; late checkout replay cannot undo refund.
These last ordering/retry deliveries use local test HMAC; provider forwarding is
proved separately. Synthetic objects only, with no live-mode credentials loaded.

Remaining release gates: deployed paired Cloudflare canary with public-media
readiness and form-to-lead, complete browser acceptance, optional Studio/social
compatibility and final release review/metadata. No production Home deploy or
release publication. Shared plan contains the receipts and proposed isolated
canary deployment, which needs Luke's per-deploy word under Auto Agency AGENTS.md.

## Deployed browser findings — 2026-11-03

Approved dedicated Cloudflare canaries passed deployed owner/auth, scoped MCP,
form capture through service binding (one lead on repeated capture), approval,
key revocation, social-off and actual public R2 image-readiness probes. Browser
login, owner approval and rejection also passed. Browser testing found narrow
mobile layout overflow and a stale proposed card after execution error; fixed
responsive sidebar defaults (explicit choices preserved), constrained key inputs
and refresh after decision failure. TypeScript/MCP 63 pass; only pre-existing
ThemeToggle lint warning remains. Canary redeploy/browser verification follows.

## Deployed core canary acceptance — 2026-11-03

Luke approved two isolated Cloudflare test sites. Release source backend
`8e7008c`, frontend `a052c37`; dedicated root deployment refs backend `2a9ed7f`,
frontend `36c3b3a`. CANARY-STATE.md in the dedicated deployment checkouts records
Worker IDs and URLs. Provider/project/live map records are in the shared plan.

- Owner login, scoped MCP, approval, duplicate refusal, key revocation and
  unauthorized API refusal pass through the actual deployed backend.
- Frontend form uses the authoritative backend service binding; repeated capture
  retains one lead. Browser desktop/mobile submissions each have one lead.
- Real public-media readiness verifies R2 storage, optimisation and public bytes.
- Browser approve/reject/error refresh, scope validation, Analytics source/device
  intersection, empty state and old Funnel redirect pass. No Money menu/page.
- Mobile layouts and failed-approval refresh bugs found by the browser rehearsal
  are fixed in `8e7008c`; TypeScript and MCP 63 checks pass, paired canary builds pass.
- Social on with no connected provider can save an unscheduled draft locally;
  social off refuses its API on the deployed canary. No publication attempted.
- Studio 1.7.2 checkout planning checks 117 owned paths: none auto-replaced;
  shared sidebar/types/config/package need manual merge. No runtime upgrade yet.

Public release remains untagged; no member production Home changed. Hosted
recovery and Stripe evidence is recorded separately in the shared plan. Canary
frontend-only `/canary-check` is intentionally excluded from release source.
