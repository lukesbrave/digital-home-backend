# Digital Home Starter 3.0.0 — backend release candidate

Publication is pending. This prepared version is not the public latest release.
Publish backend and frontend 3.0.0 together; RELEASE-PAIR.json contains the paired
versions, application baselines and exact migration hashes. VERSION is the public
Starter version; package.json's internal application package version is separate.

The backend adds Home discovery, scoped keys, 14 MCP tools, owner Approvals,
events, Analytics, payment/fulfilment APIs and preservation/recovery tools.
The frontend supplies matching schema types and event provenance. There is no
bundled Money screen. Planning/project/deliverable capabilities remain available
to agents and custom interfaces. Payouts are records, not automated transfers.

## New Home

Use the released pair, Node 22+ and the setup guides in their exact tags. Apply
frontend 001–011 first, then backend 001–008 to the same empty Supabase project;
verify tracked history. Configure the member's own accounts and public media.
Prove owner login, their public pages/images and form-to-one-CRM-lead before
handover. Email, social, payments, brand work, custom design and Studio are later
choices; missing optional services do not block a verified foundation.

## Existing Home

Follow the backend's released UPGRADE-3.md with the existing employee. Preserve
both repositories, database/account/configuration and all media; prove recovery
in an isolated target. Review shared files and full actual schema types. Existing
master/named keys keep their signing mode; scope migration is a separate choice.
Installed Studio and custom Money interfaces survive through reviewed merges.
New member SQL uses unused 900–999; official 001–899 is reserved per repository.
Timestamp-named module migrations keep their module's own installer/history.

## Evidence and limits

Maintainer rehearsals cover paired builds, hosted cold install, separate-target
Auth/Storage/custom-schema/R2 recovery, Stripe test lifecycle/retry/order,
deployed desktop/mobile owner/approval/Analytics/form/media checks, and an
unchanged older-Simon upgrade rehearsal. Studio 1.7.2 testing covers actual
pre/post-migration schema/data, existing app saved-work comparison, safe/stale
saves, paired generated types/builds and local Cloudflare static/runtime checks.
No paid model/creative or live social/payment operation is part of these proofs.

Every member still needs per-Home verification and an approved deployment.
A database backup excludes later writes; reconcile them before cutover. Reverting
a Worker does not reverse a migration. Publishing this Starter does not update
existing member installations or employees automatically.
