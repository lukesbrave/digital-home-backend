# Fresh paired database installation

Use this guide for a **new empty Supabase project**, with both repositories
checked out at the paired published release tags. Existing, partially installed
or customised Homes follow `UPGRADE.md`; never replay all starter SQL on them.
Simon follows the mission in the existing DM and uses these release instructions
for the technical steps, whether hired through the Team plugin or the web card.

## Apply, record, verify

1. Verify the owner, organisation and exact Supabase project reference before
   any write. Keep the backend and frontend in separate folders, using that one
   project. Read `RELEASE-PAIR.json` and verify the paired tags and file hashes.
2. Apply each official frontend migration `001`–`011`, then every official
   backend migration `001`–`008`, in order. Use the authenticated Management API
   SQL endpoint, one file per call, checking each response before continuing.
   CLI/SQL Editor are fallbacks. Save the successful filenames and responses,
   excluding credentials. Stop on any error; do not seed a failed installation
   or rerun non-idempotent SQL to repair history.
3. **Record both repositories before deployment or handover.** Backend `003`
   creates the history table but does not fill it. Raw Management API/SQL Editor
   calls and `apply-migration.mjs` do not record migration history automatically.
   From the backend checkout, generate the history-only SQL:

   ```sh
   node scripts/fresh-install-history.mjs --frontend ../digital-home-frontend > /tmp/digital-home-fresh-history.sql
   ```

   Adjust the frontend path to the actual paired checkout. Check the command's
   success before using the output. It validates the exact official migration
   inventory/hashes and requires the frontend; no database credentials are used.
   Review and execute the generated SQL through the **same verified project's**
   Management API SQL endpoint. This needs the existing protected Management API
   access, not a database password. The SQL checks schema markers and conflicting
   history, then records all files in one transaction. It does not replay migration
   SQL or alter application records. Missing markers or conflicting history stop
   the write. Markers alone do not prove every statement ran: the successful
   per-file execution responses in step 2 remain required. Do not use this helper
   to adopt an existing member database. Repeating the exact successful history
   query preserves its rows and timestamps.
4. Check the returned history against `RELEASE-PAIR.json`: **19 rows**, 11
   frontend and 8 backend, each with the full filename and matching checksum.
   Compare the exact set, not just its count. Keep the result as setup evidence.
   After deploying, authenticate `GET /api/home` and verify the installed version,
   all five `module_schema` flags and the same 19 recorded migrations. Capability
   flags alone only report available code. Do not declare setup complete if
   history or any required module schema is missing.
5. Continue admin access, public R2/media, the paired deployments and the mission's
   owner-login/public-pages/form-to-one-CRM-lead proofs. Optional email, social,
   payments, brand work and Studio remain separate choices. No Money or Approvals
   screen is required; agent capabilities remain available.

## Direct database alternative

If SQL was already successfully applied and a verified database connection is
available, the existing tools can record history instead. First install backend
dependencies and configure its ignored `.env.local` with the verified Supabase
URL. Retrieve any password Simon generated from his owner-only secret store;
never put credentials in command arguments or logs, or reset a database password
just for this step. Use the protected environment, hidden prompt or password stdin.

```sh
node scripts/migrations-status.mjs --frontend ../digital-home-frontend --json
node scripts/migrations-seed.mjs --project-ref PROJECT_REF --frontend ../digital-home-frontend --dry-run
node scripts/migrations-seed.mjs --project-ref PROJECT_REF --frontend ../digital-home-frontend --yes
node scripts/migrations-status.mjs --frontend ../digital-home-frontend --json
```

Before seeding, all 19 migrations must be inferred or already recorded with
matching checksums. Afterwards require 19 applied, zero inferred/partial/pending,
no missing markers and every checksum matching. The status command's zero exit
code means it could read the database, not that setup is complete. The seed may
skip partial/pending files and still exit successfully: review the actual result.
If the frontend is skipped, a checksum conflicts, or any file is incomplete, stop
and investigate instead of announcing success. Preserve existing records.
