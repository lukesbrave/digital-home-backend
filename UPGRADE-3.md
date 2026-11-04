# Upgrade an existing Home with your current Simon

Use only with the paired published 3.0.0 releases. A development branch is not “latest”.
After release, the owner gives their existing Simon the immutable release URL for
this guide and the approved tag. No employee rehire, instruction replacement or
training installation is needed to read and follow it. This is a task runbook,
not a new employee personality or a replacement for locally customised training.

## Member prompt (use only after the release is approved)

“Simon, read the Starter 3.0 upgrade guide at the release link I provide. Check my
existing Home, preserve my customisations, prepare and test the upgrade, and show
me the result before deploying. Keep your current instructions and training.”

## Agent procedure

1. Identify the member's actual backend, frontend, live URLs and versions from
   their project. Never switch to another Home based on a globally named key.
   Verify the released target tag and matching VERSION. Do not choose a moving
   main branch, this development branch or a guessed release URL.
2. Read the project's own rules. Inspect both git states. Preserve dirty work;
   never stash, reset, clean or overwrite it. Work on named branches in separate
   `.worktrees/` checkouts. Existing client branches, designs and domains remain.
3. Follow [the recovery procedure](RECOVERY-3.md) before edits and prove an
   isolated restore. Make a recoverable code/database/media backup. Include custom
   schema, legacy storage and account/configuration recovery. Record proof of
   recovery separately; the preservation tool below is only code evidence.
   Test against an isolated copy with outbound sends and real payments disabled.
4. Read the target release's UPGRADE.md and tools from its pinned source. Review
   changed tool files before adopting them: local customisations apply to scripts
   too. Use the target copy of `upgrade-preservation.mjs` against BOTH clean
   member checkouts before taking any new code. Name each checkout's actual
   baseline tag and its matching target tag. Keep receipts outside git, private.

   `node /path/to/reviewed-release/scripts/upgrade-preservation.mjs capture --root /path/to/member-backend --base v2.9.0 --target <released-backend-tag> --receipt /private/path/backend-before.json`

   Repeat for frontend with its own base/target. The capture stores hashes and
   file modes of all custom additions, edits and deletions; it never copies keys
   or file contents. The target objects must already exist in the member repo.
5. Bootstrap reviewed target upgrade tools on the upgrade branch as described in
   UPGRADE.md. Run the dry run first. Confirm the database project with the owner
   before any write; never pass passwords or keys as command arguments. A partly
   applied migration blocks progress. Preserve existing migration files/checksums
   and member migrations (new files use 900–999; existing files need review before any renumbering). Read and review new SQL before approval.
6. Run the preparation tool. Merge listed files by hand; do not replace whole
   configuration, sidebar, auth or shared type files. Keep custom columns/types,
   bindings, routes, site design and the member's social activation choice.
   Scripts stop before deployment and keep VERSION unchanged. A zero exit code
   here means preparation completed, not that the Home is upgraded.
7. Run the preservation verifier for both checkouts using the target tools:

   `node /path/to/reviewed-release/scripts/upgrade-preservation.mjs verify --root /path/to/member-backend --receipt /private/path/backend-before.json`

   Every unreviewed changed custom file fails. If a custom file intentionally
   needed a merge, inspect the diff and test the custom behaviour. An optional
   private `--approvals /path/reviewed.json` file maps that exact path to
   `{ "reason": "what was preserved and checked", "after": { "sha256": "reviewed file hash", "mode": "100644" } }`.
   A reviewed deletion uses `after: null`. Never blanket-approve a report or
   generate approvals merely to silence a failing check. Changed bytes after
   approval fail again. Retain the original before-receipt.
8. Run the target release's tests and both production builds. Verify database history,
   owner login, public site, form-to-lead, article images, custom pages, workflows,
   social state/queued posts and optional Studio. Old credentials must continue
   working: do not rotate the master, change signing mode or require new per-agent
   keys as part of adopting the release. New scoped access is a separate verified
   setup. Preserve original media URLs unless an explicit migration is tested.
9. Rehearse recovery. A prior Worker deploy cannot undo a database migration.
   Compare row values and media as well as counts, and test prior-code compatibility
   or a restored backup. Do not claim full recovery from a code receipt alone.
10. Show the member the exact changes, conflicts, checks and recovery plan. Stop
    for production approval. After an approved committed deployment, verify the
    live core flows and record the actual installed versions and commit receipts.
    If anything fails, report it and recover; never write a success receipt first.

## Compatibility boundary

This guide uses ordinary reading, git and Node commands. It does not require a
new Buzz plugin API or a refreshed Simon card. A real old-Simon rehearsal is still
a release gate: a text-contract test is not proof of model behaviour. If an old
runtime cannot execute the task, report that specific limitation; do not quietly
replace the employee or install training. Keep the client's existing identity,
memories, chat history and local training untouched.

## Candidate migrations and new modules (not a release)

Backend 004 adds agent keys, 005 events, 006 Money and 007 payment receipts.
They follow the paired frontend 001–011 and backend 001–003 baseline. Run them
through the history-aware upgrade tool in filename order, never by rerunning all
SQL. The new-table migrations deliberately stop if a member already owns a table
with that name. Review/adopt that custom schema explicitly; never drop or rename
it automatically, skip the guard or mark an unapplied migration as complete.

Do not change API_PER_KEY_SIGNING, existing keys, signing secrets or the employee
card/training during upgrade. Legacy signed requests are tested without the new
key table. New keys are optional and limited to the guide's reviewed route list;
they are not a drop-in replacement for a legacy agent's complete access yet.

Money requires the member's own Stripe setup as a separate approved action.
Without it, checkout/invoice sending returns unavailable. New fulfilment recipes
are owner-requested drafts. Seeding again preserves existing template wording,
steps, statuses and onboarding selections. It does not activate them. The event
`payment.processed` records webhook handling, not a sale/revenue amount.

Local SQL tests cover original paired schema installation, custom row/column and
workflow preservation, table-name collision refusal, role restrictions and payment
receipt retries/rollback. They do not prove Supabase Auth/Storage recovery, Stripe
network integration, installed Studio compatibility or a real old-Simon run.

The upgrader now leaves differing frontend database types untouched even when
they are committed and the checkout is clean. Merge member columns/types in both
repositories and verify them; never copy the backend file over the frontend merely
to make them match. See OLD-SIMON-REHEARSAL.md for the inspected older training
baseline, the native-runtime blocker and the remaining model-behaviour proof.

## Optional payment interfaces

The release provides payment and fulfilment APIs without a default Money page.
Preserve any existing member Money page, navigation, records and integrations.
Do not delete a member interface merely because it is absent from the starter.

For generated shared types use [SCHEMA-TYPES.md](SCHEMA-TYPES.md). For scoped agent connections and owner approvals see [MCP.md](MCP.md). Review migration 008 as part of the official backend set.

## Existing Studio and other member modules

Starter upgrades do not install or upgrade Studio. Preserve the module's own
files, timestamp-named SQL and release receipt; do not rename that SQL to 900+
or send it through the Starter migration runner. Its own signed upgrade process
continues to own those migrations. Check for generic table-name collisions
before applying Starter SQL; do not adopt an incompatible existing table.

Merge shared files explicitly: keep the Studio navigation link, every middleware
exception (including `/studio/workspace`), the static workspace materialisation
build command and Static Assets routing, all member bindings, and Studio's
required dependencies. A shared node_modules folder can hide missing package
entries. Compare the member's package file with their verified installed-module
manifest; install from the merged lockfile and build in an isolated checkout.
Do not copy a vendor Home's package file or silently upgrade the Studio module.

Generate types from the Home's complete actual schema. Preserve local helpers
and add the target release's newly required helper aliases when absent; the
preparation tool deliberately does not invent aliases or resolve domain types.
Review each removal: the old handwritten types may name uninstalled optional
or private tables. Verify absence and code consumers before removing a stale
placeholder; never remove a real custom table/column to make type checking pass.
Build both applications with the reviewed generated schema.

Open a saved Studio board before/after: preserve sources, notes, desk history,
queued jobs and graph revisions; prove a safe save and stale-edit refusal. Check
Studio readiness and the built static-workspace route. Studio 1.7.2 continues
to accept its existing owner session/master Bearer boundary; a new Starter
scoped key does not grant Studio access. Keep the current runner and credentials.
A Starter update does not authorize paid model work, publishing queued jobs or
restarting a busy runner. Test each Home's installed modules before its deploy.

## Approval capability without a bundled screen

Do not add a default Approvals page/menu during an upgrade. Preserve any member
interface already present. Follow APPROVALS.md for owner decisions through the
existing Buzz agent and signed master connection; scoped employee keys retain
proposal/status access only. Never rotate, disclose or distribute the owner key
as a side effect of removing the screen. Verify explicit approve/reject, denial
for ordinary keys, duplicate refusal and the recorded result before handover.
