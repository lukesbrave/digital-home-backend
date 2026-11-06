# Fresh paired database installation

Use this procedure only for a newly provisioned, empty Supabase project. Start
before creating an admin user, a storage bucket or any starter tables. Existing,
customised and interrupted installations require individual review under UPGRADE.md.

1. Confirm the owner, organisation and target project reference. Obtain both
   repositories at the paired release tags and verify the published source
   hashes. In the backend checkout, run the local check before any database write:

       node scripts/fresh-install.mjs --frontend ../digital-home-frontend --preflight

   This checks both VERSION files, both release manifests, and every migration
   filename and checksum. Database access is unnecessary for this step.
2. Set SUPABASE_URL in this backend checkout's ignored .env.local. Supply
   SUPABASE_ACCESS_TOKEN through the protected process environment. Keep a new,
   private receipt file outside both repositories. Run from the backend:

       node scripts/fresh-install.mjs --frontend ../digital-home-frontend --project-ref PROJECT_REF --receipts /private/path/fresh.jsonl --yes

   Replace the example paths and reference. For a direct PostgreSQL connection,
   add --direct and supply the database password by hidden prompt or protected
   environment. Both paths repeat preflight and run the same checks. The runner
   checks the target, applies frontend 001–011 then backend 001–008 in order,
   and saves one receipt for each successful file. It records history in one
   transaction and compares the returned 19 filenames, repositories and checksums.
3. Stop on an error or uncertain response. Keep the receipt file and inspect
   the project before any further action. Never replay the files, manufacture
   receipts or use the legacy seed tool to complete a fresh installation.
   If all 19 receipts exist and only the history step needs retrying, repeat
   the command with --record-only and the same receipt path and project.
   This verifies the complete receipt set, critical columns, row security,
   policies, triggers and conflicting history. A repeat preserves timestamps.
4. After success, create the owner login and continue the paired deployment.
   Authenticate GET /api/home and verify both the exact 19 records and all five
   module_schema flags. Verify owner sign-in, public media and one test form
   submission arriving as exactly one CRM lead before handover.
