# Upgrade an existing Home with your current Simon

Development candidate — not released. Do not deploy this branch or use it as “latest”.
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
3. Before edits, make a recoverable code/database/media backup. Include custom
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
   and member 900+ migrations. Read and review new SQL before approval.
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
8. Run the candidate's tests and both production builds. Verify database history,
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
