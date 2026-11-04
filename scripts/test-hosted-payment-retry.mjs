// Pinned isolated test project and Stripe test-only credentials.
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, openSync } from "node:fs";
import { randomBytes, createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  require = createRequire(root + "/package.json"),
  { createClient } = require("@supabase/supabase-js");
const keys = JSON.parse(readFileSync("/private/tmp/starter3-hosted-keys.json")),
  key = (n) => keys.find((k) => k.name === n).api_key,
  url = "https://iotldbnwtnzpwpyhwgmo.supabase.co";
const db = createClient(url, key("service_role"), {
    auth: { persistSession: false },
  }),
  profile = readFileSync("/private/tmp/starter3-stripe-test.toml", "utf8"),
  stripeKey = JSON.parse(profile.match(/^test_mode_api_key = (.+)$/m)[1]),
  secret = "whsec_" + randomBytes(32).toString("hex"),
  master = JSON.parse(
    readFileSync("/private/tmp/starter3-runtime-private.json"),
  ).master;
const log = openSync("/private/tmp/starter3-retry-next.log", "w", 0o600),
  app = spawn(
    process.execPath,
    [
      root + "/node_modules/next/dist/bin/next",
      "dev",
      "--hostname",
      "127.0.0.1",
      "-p",
      "4101",
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        NEXT_PUBLIC_SUPABASE_URL: url,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: key("anon"),
        SUPABASE_SERVICE_ROLE_KEY: key("service_role"),
        API_SECRET_KEY: master,
        STRIPE_SECRET_KEY: stripeKey,
        STRIPE_WEBHOOK_SECRET: secret,
        SOCIAL_PUBLISHING_ENABLED: "false",
      },
      stdio: ["ignore", log, log],
    },
  );
const origin = "http://127.0.0.1:4101";
try {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(origin + "/api/agent/actions")).status === 401) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  const { data: events, error } = await db
    .from("payment_events")
    .select("*")
    .eq("type", "charge.refunded")
    .is("processed_at", null);
  assert.ifError(error);
  assert.ok(events.length);
  for (const event of events) {
    const raw = JSON.stringify(event.payload);
    let attempts = 0,
      held = false;
    for (;;) {
      const t = Math.floor(Date.now() / 1000),
        sig = createHmac("sha256", secret)
          .update(t + "." + raw)
          .digest("hex"),
        r = await fetch(origin + "/api/webhooks/stripe", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "stripe-signature": `t=${t},v1=${sig}`,
          },
          body: raw,
        });
      const body = await r.json();
      attempts++;
      if (r.status === 200) {
        assert.ok(body.received);
        break;
      }
      assert.equal(r.status, 409, JSON.stringify(body));
      held = true;
      if (attempts > 35) throw new Error("Claim did not expire");
      await new Promise((r) => setTimeout(r, 10000));
    }
    const { data: settled } = await db
      .from("payment_events")
      .select("processed_at,error,result")
      .eq("id", event.id)
      .single();
    assert.ok(settled.processed_at);
    assert.equal(settled.error, null);
    assert.ok(settled.result.orderId);
    console.log(
      JSON.stringify({
        interrupted_refund_recovered: true,
        live_claim_refused: held,
        attempts,
        event: event.provider_event_id,
      }),
    );
  }
  writeFileSync(
    "/private/tmp/starter3-payment-retry-receipt.json",
    JSON.stringify({
      format: "starter3_payment_retry_v1",
      at: new Date().toISOString(),
      interrupted_refund_recovered: true,
      processed_events: events.length,
      no_manual_claim_edit: true,
      limitations: [
        "replayed original provider event with local test signing secret",
      ],
    }),
  );
} finally {
  app.kill("SIGTERM");
}
