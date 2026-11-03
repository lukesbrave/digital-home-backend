// Pinned isolated source and target; never restore over a member Home.
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const require = createRequire(
    resolve(dirname(fileURLToPath(import.meta.url)), "../package.json"),
  ),
  { createClient } = require("@supabase/supabase-js");
const config = (ref) => {
  const file =
    ref === "iotldbnwtnzpwpyhwgmo"
      ? "/private/tmp/starter3-hosted-keys.json"
      : "/private/tmp/starter3-recovery-keys.json";
  const k = JSON.parse(readFileSync(file));
  return {
    url: "https://" + ref + ".supabase.co",
    key: (n) => k.find((x) => x.name === n).api_key,
  };
};
const sourceConfig = config("iotldbnwtnzpwpyhwgmo"),
  targetConfig = config("uwgpjpudrhzkskjnlqkn");
const source = createClient(
    sourceConfig.url,
    sourceConfig.key("service_role"),
    { auth: { persistSession: false } },
  ),
  target = createClient(targetConfig.url, targetConfig.key("service_role"), {
    auth: { persistSession: false },
  }),
  anon = createClient(targetConfig.url, targetConfig.key("anon"), {
    auth: { persistSession: false },
  });
const credentials = JSON.parse(
    readFileSync("/private/tmp/starter3-runtime-private.json"),
  ),
  original = JSON.parse(
    readFileSync("/private/tmp/starter3-hosted-runtime-receipt.json"),
  );
const login = await anon.auth.signInWithPassword({
  email: credentials.email,
  password: credentials.password,
});
assert.ifError(login.error);
assert.equal(login.data.user.id, credentials.userId);
const media = await source.storage
  .from(original.bucket)
  .download("fixture.txt");
assert.ifError(media.error);
const bytes = Buffer.from(await media.data.arrayBuffer());
assert.ifError(
  (
    await target.storage
      .from(original.bucket)
      .upload("fixture.txt", bytes, { upsert: true, contentType: "text/plain" })
  ).error,
);
const recovered = await target.storage
  .from(original.bucket)
  .download("fixture.txt");
assert.ifError(recovered.error);
const hash = (b) => createHash("sha256").update(b).digest("hex");
assert.equal(
  hash(Buffer.from(await recovered.data.arrayBuffer())),
  hash(bytes),
);
const publicClient = createClient(targetConfig.url, targetConfig.key("anon"), {
  auth: { persistSession: false },
});
assert.ok(
  (await publicClient.storage.from(original.bucket).download("fixture.txt"))
    .error,
);
const { data: history, error: he } = await target
  .from("schema_migrations")
  .select("repo,name,checksum")
  .order("repo")
  .order("name");
assert.ifError(he);
assert.equal(history.length, 19);
const { data: actions, error: ae } = await target
  .from("agent_actions")
  .select("status,result");
assert.ifError(ae);
assert.ok(
  actions.some((a) => a.status === "executed" && a.result?.calendar_entry_id),
);
const { count: targetProducts } = await target
  .from("products")
  .select("id", { count: "exact", head: true });
const { count: sourceProducts } = await source
  .from("products")
  .select("id", { count: "exact", head: true });
assert.equal(targetProducts, 0);
assert.ok(sourceProducts > 0);
const receipt = {
  format: "starter3_hosted_recovery_v1",
  at: new Date().toISOString(),
  source: "iotldbnwtnzpwpyhwgmo",
  target: "uwgpjpudrhzkskjnlqkn",
  separate_target: true,
  auth_login_same_identity: true,
  migrations: history.length,
  approved_action_recovered: true,
  private_storage_hash_match: true,
  anonymous_storage_refused: true,
  post_snapshot_writes_demonstrated: {
    source_products: sourceProducts,
    restored_products: targetProducts,
    cutover_performed: false,
    requires_reconciliation: true,
  },
  limitations: [
    "R2 not tested",
    "no production cutover",
    "custom schema recovery and old-Simon hosted rehearsal pending",
  ],
};
writeFileSync(
  "/private/tmp/starter3-hosted-recovery-receipt.json",
  JSON.stringify(receipt, null, 2),
);
console.log(JSON.stringify(receipt));
