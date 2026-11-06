# Starter 3.0.1 — fresh setup history correction

Pair backend and frontend `v3.0.1`. Verify both GitHub releases are published
before selecting them; a preparation branch is not a release. The immutable
3.0.0 releases remain available.

Fresh setup must apply all 11 frontend and 8 backend migration files, then
record their full repository/filename/checksum identities before handover.
The backend's `FRESH-INSTALL.md` provides a Management API workflow and a
protected direct-connection alternative. Both installation paths validate both VERSION files and release manifests before the first write,
retain project-bound receipts after each successful file and run the same atomic history check.
It verifies required columns, row security, policies, triggers and conflicting history; it never replays the schema SQL. The status/seed tools now recognise
enabled database triggers, including migration 007's payment receipt trigger.
The frontend setup documents now point to the full backend sequence.

No new SQL migration, application UI, dependency or database schema change.
No default Money or Approvals screen; the agent capabilities remain intact.
Existing Homes are not automatically changed. For an already running 3.0.0 Home,
inspect actual history and schema using the reviewed status tools; follow
`UPGRADE.md` for missing history, without replaying starter SQL. Do not use
the fresh-install helper to adopt a customised member database.

Validation: isolated PostgreSQL-compatible fresh installs, exact 19-row checks,
all five Home module flags, repeat-history preservation, missing/disabled trigger
and incomplete-schema refusal, conflicting-history preservation and local file
hash/member-migration refusal. These automated tests exercise the shared setup
sequence delivered by both recruitment paths; they do not constitute two native
Buzz hiring sessions or two newly hosted member deployments.
