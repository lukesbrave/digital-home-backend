// Explicitly pinned to the isolated Starter test project. Creates synthetic records only.
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import { randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(root + "/package.json");
const { createClient } = require("@supabase/supabase-js");
const keys = JSON.parse(
    readFileSync(
      process.env.STARTER3_TEST_KEYS_FILE ||
        "/private/tmp/starter3-hosted-keys.json",
      "utf8",
    ),
  ),
  url = "https://iotldbnwtnzpwpyhwgmo.supabase.co";
const key = (n) => keys.find((k) => k.name === n).api_key;
const admin = createClient(url, key("service_role"), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anon = createClient(url, key("anon"), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const password = randomBytes(24).toString("hex"),
  email = "starter3-" + Date.now() + "@example.test",
  master = randomBytes(32).toString("hex");
const { data: u, error: ue } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  app_metadata: { role: "admin" },
});
assert.ifError(ue);
const { data: login, error: le } = await anon.auth.signInWithPassword({
  email,
  password,
});
assert.ifError(le);
assert.equal(login.user.id, u.user.id);
writeFileSync(
  "/private/tmp/starter3-runtime-private.json",
  JSON.stringify({ email, password, userId: u.user.id, master }),
  { mode: 0o600 },
);
const bucket = "starter3-proof-" + Date.now(),
  bytes = Buffer.from("Starter 3 synthetic storage recovery fixture\n");
assert.ifError(
  (await admin.storage.createBucket(bucket, { public: false })).error,
);
assert.ifError(
  (
    await admin.storage
      .from(bucket)
      .upload("fixture.txt", bytes, {
        contentType: "text/plain",
        upsert: false,
      })
  ).error,
);
const download = await admin.storage.from(bucket).download("fixture.txt");
assert.ifError(download.error);
assert.equal(
  createHash("sha256")
    .update(Buffer.from(await download.data.arrayBuffer()))
    .digest("hex"),
  createHash("sha256").update(bytes).digest("hex"),
);
const denied = await anon.storage.from(bucket).download("fixture.txt");
assert.ok(denied.error);
const env = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: url,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: key("anon"),
  SUPABASE_SERVICE_ROLE_KEY: key("service_role"),
  API_SECRET_KEY: master,
  API_SIGNATURE_REQUIRED: "true",
  SOCIAL_PUBLISHING_ENABLED: "false",
};
const log = await import("node:fs").then((f) =>
  f.openSync("/private/tmp/starter3-hosted-next.log", "w", 0o600),
);
const child = spawn(
  process.execPath,
  [
    root + "/node_modules/next/dist/bin/next",
    "dev",
    "--hostname",
    "127.0.0.1",
    "-p",
    "4101",
  ],
  { cwd: root, env, stdio: ["ignore", log, log] },
);
const cookie =
  "sb-iotldbnwtnzpwpyhwgmo-auth-token=base64-" +
  Buffer.from(JSON.stringify(login.session)).toString("base64url");
const origin = "http://127.0.0.1:4101";
let ready = false;
try {
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(origin + "/api/agent/actions");
      if (r.status === 401) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.ok(ready, "local app ready");
  const req = async (path, body) => {
    const r = await fetch(origin + path, {
      method: body ? "POST" : "GET",
      headers: { cookie, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json();
    assert.ok(r.ok, `${path}: ${r.status} ${data.error || ""}`);
    return data;
  };
  const keys = await req("/api/settings/agent-keys", {
    name: "runtime-proof-" + Date.now(),
    scopes: ["settings:read", "content:write"],
  });
  const token = keys.key.plaintext;
  const rpc = async (name, args = {}) => {
    const r = await fetch(origin + "/api/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.result.isError, false, JSON.stringify(data));
    return JSON.parse(data.result.content[0].text);
  };
  const home = await rpc("home.info");
  assert.ok(home);
  const proposal = await rpc("article.propose", {
    title: "Synthetic hosted release proof",
    target_keyword: "starter3 hosted proof " + Date.now(),
  });
  assert.ok(proposal.action_id);
  await req("/api/agent/actions/" + proposal.action_id, {
    decision: "approve",
  });
  const replay = await fetch(
    origin + "/api/agent/actions/" + proposal.action_id,
    {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ decision: "approve" }),
    },
  );
  assert.equal(replay.status, 409);
  const { data: action } = await admin
    .from("agent_actions")
    .select("status,result")
    .eq("id", proposal.action_id)
    .single();
  assert.equal(action.status, "executed");
  assert.ok(action.result.calendar_entry_id);
  const anonQueue = await anon.from("agent_actions").select("id");
  assert.ok(anonQueue.error);
  const receipt = {
    format: "starter3_hosted_runtime_v1",
    project: "iotldbnwtnzpwpyhwgmo",
    at: new Date().toISOString(),
    auth_login: true,
    private_storage_upload_download_hash: true,
    anonymous_storage_refused: true,
    owner_session: true,
    scoped_mcp: true,
    article_approval_executed: true,
    repeat_approval_refused: true,
    anonymous_queue_refused: true,
    bucket,
    synthetic_user_id: u.user.id,
    limitations: [
      "local Next runtime with hosted Supabase; no Cloudflare deploy",
      "storage roundtrip only, not separate-project restore",
      "no Stripe or R2 proof",
    ],
  };
  writeFileSync(
    "/private/tmp/starter3-hosted-runtime-receipt.json",
    JSON.stringify(receipt, null, 2),
  );
  console.log(JSON.stringify(receipt));
} finally {
  child.kill("SIGTERM");
}
