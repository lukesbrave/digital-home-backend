# Starter 3.0 recovery — preparation and release gates

Development only. A successful code rollback is not a database/media recovery.
Do not begin a member upgrade until that Home has a private recovery set and a
successful isolated restore. This procedure is a task guide for the member's
existing Simon; it does not change his card, training, identity or memory.

## What the recovery set must contain

| Component | Required preservation | Proof before upgrading |
|---|---|---|
| Backend and frontend | Git bundles of all member refs, recorded current branch/commit, reviewed uncommitted and untracked work, executable modes and deleted custom pages | Restore into separate folders; compare commits, custom files and required local files; build both |
| Database | Consistent provider backup or full PostgreSQL custom-format dump: custom schemas, tables, rows, functions, views, triggers, policies, privileges, sequences and migration history | Restore into an empty isolated target; compare schema and actual values, then run old application reads/writes |
| Authentication | Provider-supported Auth backup/recovery and original account identities | Owner signs into the isolated restored Home; a copied auth table is not proof of working authentication |
| Legacy Storage and R2 | Bucket/object metadata AND actual object bytes, content types, private/public policies and media URL strategy | Compare object inventory, counts and hashes; load images/files through restored application routes |
| Configuration and accounts | Secure owner-held recovery of required settings, bindings, DNS/custom domains, provider access and secrets | Reconnect only intended isolated resources; never print credentials, put them in arguments or commit them |
| Optional Studio/social | Installed release receipt, runner state, job/media storage and connection strategy | Verify with workers/sends/payments disabled; retain queued work and ensure no duplicate publication |

Database dumps can contain personal data and secrets. Keep artifacts and their
receipts outside git in private (0700) folders, files 0600 where appropriate,
and use the owner's encrypted backup storage. Do not upload raw dumps or training/
identity directories for review. Report hashes, counts and test outcomes only.

## Recovery sequence for the existing Simon

1. Identify the actual paired repositories, database and all media stores from the
   member's project. Record the real source identity privately. Stop if unknown.
   A checkout being clean does not mean its files are uncustomised.
2. Preserve dirty/untracked work without stash/reset/clean. Do not silently exclude
   a custom file because it is ignored. Inventory its owner-approved recovery
   location; keys/configuration go through private recovery, never a git commit.
3. Arrange a write-quiescent window for the isolated rehearsal: stop worker ticks,
   scheduled publishing, email sends, incoming writes and payment processing on
   the COPY. For a real backup/cutover, owner approval and a plan for queued writes
   and payment redelivery are required. A database snapshot does not atomically
   snapshot R2 or Storage. Never claim consistency while those writers continue.
4. Create full database and code backups with the owner's existing secure tools.
   PostgreSQL `pg_dump --format=custom` provides a consistent database snapshot;
   do not use a public-schema-only PostgREST export as the complete recovery set.
   Use a private libpq service/password file or provider-supported secure flow,
   never credentials inside command strings. Keep the archive compatible with
   the source server version and target provider's supported restore procedure.
5. Capture actual media bytes and metadata. Store configuration/account recovery
   instructions securely. Verify every expected store was inventoried; an empty
   folder cannot count as a completed media export. Preserve permissions when
   copying recovery artifacts; ordinary copying may change private folder modes.
6. Capture artifact integrity once the recovery set is complete:

   `node scripts/recovery-files.mjs capture --root /private/recovery/artifacts --receipt /private/recovery/before.json`

   Use canonical paths (no symlink parents), with the receipt outside the artifact
   tree. Capture refuses an existing receipt. Verify before and after transfer:

   `node scripts/recovery-files.mjs verify --root /private/recovery/restored-artifacts --receipt /private/recovery/before.json`

   The verifier checks file bytes, permissions, directories and unexpected/missing
   files; it refuses links/special files. It prints counts, not private paths or
   contents. Keep the trusted receipt separately. This is integrity evidence, not
   encryption, authenticity, backup creation or proof the inventory was complete.
7. Restore into a separate empty target with outbound activity disabled. Never
   test a destructive restore on the source. Do not use `--clean`, overwrite an
   occupied target, drop custom tables, or bypass a collision guard. A PostgreSQL
   restore with `--exit-on-error --single-transaction` is atomic for supported
   archives; provider-managed roles/auth/storage require their supported process.
   Preserve grants/policies; do not discard them to get a green restore. Record
   any deliberate ownership mapping and test permissions explicitly.
8. Compare full schema and row values (not counts alone), next sequence values,
   member workflows/settings, custom fields, code and media hashes. Test owner
   login, old signed requests, form-to-lead, old URLs, images and custom pages.
   Rehearse failure halfway through migrations and recovery to the prior build.
9. Record the result and unresolved gaps, retaining the original trusted backup.
   Only then propose the upgrade or a separate production recovery. A point-in-
   time restore does not include new writes made after that snapshot. Reconcile
   those writes and payment events before a real cutover; never promise zero
   loss from a stale backup. Do not reconnect domains or resume jobs automatically.

## Evidence available in this candidate

Run `npm run test:recovery` for integrity/refusal tests. With local PostgreSQL
server binaries available, run:

`PG_BIN=/path/to/postgresql/bin npm run test:recovery-postgres`

The PostgreSQL test creates a disposable private Unix-socket cluster with TCP
listeners disabled, uses synthetic fixtures, clears inherited PG connection
settings, and stops/removes only its own test cluster. It does not connect to
Supabase, use member credentials, deploy code or start a system database service.

It applies the original paired starter schema, creates custom schema/functions/
views/policies/rows and account/storage metadata fixtures, takes an actual pg_dump,
interrupts an upgrade transaction, applies the new migrations, corrupts source
fixture rows and restores into a separate empty database. It verifies schema and
values, permissions, sequences, original code commits/customisations, executable
modes, deleted pages and local media/configuration bytes. Corrupt artifacts,
nonempty targets, linked files and overwriting receipts are refused.

These are actual local PostgreSQL and filesystem recovery proofs. They do NOT
prove hosted Supabase Auth login, Storage/R2 export/import, external integrations,
Studio recovery, DNS cutover or an old Simon model executing the procedure. Those
remain explicit release gates. No member should be told recovery is guaranteed
until their own isolated restore and runtime checks have passed.
