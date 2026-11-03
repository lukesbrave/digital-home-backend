# Generate database types without losing member changes

Generate from the member's actual migrated database, never the starter's template
project. This includes their custom columns and tables. Keep the original files
in a committed preservation snapshot first. No database writes are needed.

1. Confirm the project reference against the Home's configuration. With the
   member's own authenticated Supabase CLI, run `supabase gen types typescript
   --remote=PROJECT_REF --schema public > /private/tmp/member-database.ts`.
   Include each additional custom schema used by their app in the comma-separated
   schema list. Do not put passwords or access tokens in command arguments.
2. Create an empty review directory outside both apps, then run:

   ```sh
   node scripts/prepare-schema-types.mjs /private/tmp/member-database.ts src/types/database.ts ../frontend/src/types/database.ts /private/tmp/types-review
   ```

   Substitute the actual frontend path. The script writes separate review
   candidates and a hashed input report. It never overwrites either app.
   Database/Json come from generated schema; each app's other aliases and
   imports remain intact. This is deliberate: their extra type helpers can differ.
3. Read `review.json` and both full diffs. Exit 2 means a schema member disappeared:
   stop and reconcile the actual database, selected schemas, and any stale
   hand-written types. Do not hide missing custom columns by accepting the output.
   Type changes also require review even when no names disappeared.
4. After review, copy each candidate to its matching app, run both TypeScript
   checks and production builds, and verify custom pages and columns at runtime.
   Commit both files with the migration/preservation receipt. An error in a
   member alias requires a reviewed edit, not deletion of the alias.

The two generated Database blocks should match because the apps share one
schema. Their local convenience aliases need not match. This workflow does not
rename migrations or run any SQL.
