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

  const stripeApi = async (path, params, method = "POST") => {
    const r = await fetch("https://api.stripe.com/v1" + path, {
      method,
      headers: {
        authorization: "Bearer " + stripeKey,
        ...(params
          ? { "content-type": "application/x-www-form-urlencoded" }
          : {}),
      },
      body: params ? new URLSearchParams(params) : undefined,
    });
    const d = await r.json();
    assert.ok(r.ok, d.error?.message || "Stripe request failed");
    return d;
  };
  const slug = "ordering-proof-" + Date.now();
  const { error: productError } = await db
    .from("products")
    .insert({
      name: "Synthetic ordering proof",
      slug,
      kind: "one_time",
      amount_minor: 2000,
      currency: "USD",
      active: true,
    });
  assert.ifError(productError);
  const { data: order, error: orderError } = await db
    .from("orders")
    .insert({
      email: "ordering-proof@example.test",
      status: "pending",
      total_minor: 2000,
      currency: "USD",
      livemode: false,
      metadata: { product_slug: slug },
    })
    .select("id")
    .single();
  assert.ifError(orderError);
  const { spawnSync } = await import("node:child_process");
  const trigger = spawnSync(
    "stripe",
    [
      "--config",
      "/private/tmp/starter3-stripe-test.toml",
      "trigger",
      "checkout.session.completed",
      "--add",
      "checkout_session:metadata.product_slug=" + slug,
      "--add",
      "checkout_session:metadata.order_id=" + order.id,
      "--add",
      "checkout_session:payment_intent_data.metadata.order_id=" + order.id,
    ],
    { encoding: "utf8", timeout: 120000 },
  );
  assert.equal(trigger.status, 0, trigger.stderr?.slice(-500));
  const events = await stripeApi(
    "/events?type=checkout.session.completed&limit=20",
    null,
    "GET",
  );
  const checkout = events.data.find(
    (e) => e.data.object.metadata?.product_slug === slug,
  );
  assert.ok(checkout);
  await stripeApi("/refunds", {
    payment_intent: checkout.data.object.payment_intent,
  });
  let refund;
  for (let i = 0; i < 20; i++) {
    const events = await stripeApi(
      "/events?type=charge.refunded&limit=20",
      null,
      "GET",
    );
    refund = events.data.find(
      (e) =>
        e.data.object.payment_intent === checkout.data.object.payment_intent,
    );
    if (refund) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.ok(refund);
  const deliver = async (event) => {
    const raw = JSON.stringify(event),
      t = Math.floor(Date.now() / 1000),
      sig = createHmac("sha256", secret)
        .update(t + "." + raw)
        .digest("hex");
    const r = await fetch(origin + "/api/webhooks/stripe", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": `t=${t},v1=${sig}`,
      },
      body: raw,
    });
    return { status: r.status, body: await r.json() };
  };
  const early = await deliver(refund);
  assert.equal(early.status, 500);
  assert.match(early.body.error, /before its payment/);
  const { data: released } = await db
    .from("payment_events")
    .select("claimed_at,processed_at")
    .eq("provider_event_id", refund.id)
    .single();
  assert.equal(released.claimed_at, null);
  assert.equal(released.processed_at, null);
  assert.equal((await deliver(checkout)).status, 200);
  assert.equal((await deliver(refund)).status, 200);
  const repeat = await deliver(checkout);
  assert.equal(repeat.body.duplicate, true);
  const { data: finalOrder } = await db
    .from("orders")
    .select("status,total_minor,metadata")
    .eq("id", order.id)
    .single();
  assert.equal(finalOrder.status, "refunded");
  const { data: receipt } = await db
    .from("payment_events")
    .select("processed_at,error")
    .eq("provider_event_id", refund.id)
    .single();
  assert.ok(receipt.processed_at);
  assert.equal(receipt.error, null);
  const proof = {
    format: "starter3_stripe_ordering_v1",
    at: new Date().toISOString(),
    test_mode: true,
    actual_stripe_event_payloads: true,
    refund_before_checkout_refused: true,
    failure_releases_claim: true,
    checkout_then_refund_retry_settles: true,
    late_checkout_replay_cannot_revert_refund: true,
    limitations: [
      "actual provider payloads delivered with local test HMAC; provider forwarding proved separately",
    ],
  };
  writeFileSync(
    "/private/tmp/starter3-stripe-ordering-receipt.json",
    JSON.stringify(proof, null, 2),
  );
  console.log(JSON.stringify(proof));
} finally {
  app.kill("SIGTERM");
}
