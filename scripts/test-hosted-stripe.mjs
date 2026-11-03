// Pinned isolated test project and Stripe test-only credentials.
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { readFileSync, writeFileSync, openSync } from "node:fs";
import { createRequire } from "node:module";
import { createHmac } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import assert from "node:assert/strict";
const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  require = createRequire(root + "/package.json"),
  { createClient } = require("@supabase/supabase-js");
const keys = JSON.parse(readFileSync("/private/tmp/starter3-hosted-keys.json")),
  key = (n) => keys.find((k) => k.name === n).api_key,
  url = "https://iotldbnwtnzpwpyhwgmo.supabase.co",
  privateData = JSON.parse(
    readFileSync("/private/tmp/starter3-runtime-private.json"),
  );
const config = readFileSync("/private/tmp/starter3-stripe-test.toml", "utf8");
const stripeKey = JSON.parse(config.match(/^test_mode_api_key = (.+)$/m)[1]);
assert.ok(stripeKey.startsWith("sk_test_") || stripeKey.startsWith("rk_test_"));
const admin = createClient(url, key("service_role"), {
    auth: { persistSession: false },
  }),
  auth = createClient(url, key("anon"), { auth: { persistSession: false } });
const { data: login, error } = await auth.auth.signInWithPassword({
  email: privateData.email,
  password: privateData.password,
});
assert.ifError(error);
const cookie =
    "sb-iotldbnwtnzpwpyhwgmo-auth-token=base64-" +
    Buffer.from(JSON.stringify(login.session)).toString("base64url"),
  origin = "http://127.0.0.1:4101";
let signingSecret;
const listener = spawn(
  "stripe",
  [
    "--config",
    "/private/tmp/starter3-stripe-test.toml",
    "listen",
    "--forward-to",
    origin + "/api/webhooks/stripe",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let listenText = "";
const collect = (chunk) => {
  listenText += chunk.toString();
  const match = listenText.match(/whsec_[a-zA-Z0-9]+/);
  if (match) signingSecret = match[0];
};
listener.stdout.on("data", collect);
listener.stderr.on("data", collect);
let app;
try {
  for (let i = 0; i < 60 && !signingSecret; i++)
    await new Promise((r) => setTimeout(r, 500));
  assert.ok(signingSecret, "Stripe test listener ready");
  const log = openSync("/private/tmp/starter3-stripe-next.log", "w", 0o600);
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
        API_SECRET_KEY: privateData.master,
        STRIPE_SECRET_KEY: stripeKey,
        STRIPE_WEBHOOK_SECRET: signingSecret,
        SOCIAL_PUBLISHING_ENABLED: "false",
      },
      stdio: ["ignore", log, log],
    },
  );
  for (let i = 0; i < 90; i++) {
    try {
      if ((await fetch(origin + "/api/agent/actions")).status === 401) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  const request = async (path, body) => {
    const r = await fetch(origin + path, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    assert.ok(r.ok, `${path}: ${r.status} ${d.error || ""}`);
    return d;
  };
  const slug = "stripe-proof-" + Date.now();
  await request("/api/crm/products", {
    name: "Synthetic test product",
    slug,
    kind: "one_time",
    amount_minor: 2000,
    currency: "USD",
    active: true,
  });
  const checkout = await request("/api/crm/checkout", {
    product_slug: slug,
    success_url: "https://example.test/success",
    cancel_url: "https://example.test/cancel",
    email: "stripe-proof@example.test",
  });
  assert.ok(checkout.url || checkout.checkout_url || checkout.session);
  const trigger = spawnSync(
    "stripe",
    [
      "--config",
      "/private/tmp/starter3-stripe-test.toml",
      "trigger",
      "checkout.session.completed",
      "--add",
      "checkout_session:metadata.product_slug=" + slug,
    ],
    { encoding: "utf8", timeout: 120000 },
  );
  assert.equal(trigger.status, 0, trigger.stderr?.slice(-500));
  let event;
  for (let i = 0; i < 60; i++) {
    const { data } = await admin
      .from("payment_events")
      .select("*")
      .eq("type", "checkout.session.completed")
      .order("received_at", { ascending: false })
      .limit(5);
    event = data?.find(
      (e) => e.payload?.data?.object?.metadata?.product_slug === slug,
    );
    if (event?.processed_at) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert.ok(event?.processed_at, "Stripe-delivered checkout settled");
  assert.ok(!event.result?.ignored, JSON.stringify(event.result));
  const raw = JSON.stringify(event.payload),
    t = Math.floor(Date.now() / 1000),
    signature = createHmac("sha256", signingSecret)
      .update(t + "." + raw)
      .digest("hex");
  const replay = await fetch(origin + "/api/webhooks/stripe", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": `t=${t},v1=${signature}`,
    },
    body: raw,
  });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).duplicate, true);
  const bad = await fetch(origin + "/api/webhooks/stripe", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": `t=${t},v1=${"a".repeat(64)}`,
    },
    body: raw,
  });
  assert.equal(bad.status, 400);

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
  const clock = await stripeApi("/test_helpers/test_clocks", {
    frozen_time: String(Math.floor(Date.now() / 1000)),
    name: "Starter 3 lifecycle proof",
  });
  const customer = await stripeApi("/customers", {
    email: "lifecycle-" + Date.now() + "@example.test",
    test_clock: clock.id,
    payment_method: "pm_card_visa",
    "invoice_settings[default_payment_method]": "pm_card_visa",
  });
  const price = await stripeApi("/prices", {
    currency: "usd",
    unit_amount: "1000",
    "recurring[interval]": "month",
    "product_data[name]": "Synthetic lifecycle proof",
  });
  const subscription = await stripeApi("/subscriptions", {
    customer: customer.id,
    "items[0][price]": price.id,
  });
  const waitUntil = async (check, label) => {
    for (let i = 0; i < 80; i++) {
      const value = await check();
      if (value) return value;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error("Timed out: " + label);
  };
  const order = await waitUntil(async () => {
    const { data } = await admin
      .from("orders")
      .select("*")
      .eq("stripe_subscription_id", subscription.id)
      .maybeSingle();
    return data?.status === "paid" ? data : null;
  }, "initial subscription payment");
  async function advance(time) {
    await stripeApi("/test_helpers/test_clocks/" + clock.id + "/advance", {
      frozen_time: String(time),
    });
    await waitUntil(async () => {
      const d = await stripeApi(
        "/test_helpers/test_clocks/" + clock.id,
        null,
        "GET",
      );
      return d.status === "ready";
    }, "clock readiness");
  }
  let time = clock.frozen_time + 33 * 86400;
  await advance(time);
  const renewal = await waitUntil(async () => {
    const { data } = await admin
      .from("payment_events")
      .select("payload,processed_at,result")
      .eq("type", "invoice.paid");
    return data?.find(
      (e) =>
        e.processed_at &&
        e.payload?.data?.object?.customer === customer.id &&
        e.payload?.data?.object?.billing_reason === "subscription_cycle",
    );
  }, "renewal receipt");
  assert.ok(renewal.result?.summary?.includes("renewal"));
  const declined = await stripeApi(
    "/payment_methods/pm_card_chargeCustomerFail/attach",
    { customer: customer.id },
  );
  await stripeApi("/subscriptions/" + subscription.id, {
    default_payment_method: declined.id,
  });
  time += 33 * 86400;
  await advance(time);
  await waitUntil(async () => {
    const { data } = await admin
      .from("payment_events")
      .select("payload,processed_at")
      .eq("type", "invoice.payment_failed");
    return data?.some(
      (e) =>
        e.processed_at && e.payload?.data?.object?.customer === customer.id,
    );
  }, "failed renewal receipt");
  await stripeApi("/subscriptions/" + subscription.id, null, "DELETE");
  await waitUntil(async () => {
    const { data } = await admin
      .from("payment_events")
      .select("payload,processed_at")
      .eq("type", "customer.subscription.deleted");
    return data?.some(
      (e) => e.processed_at && e.payload?.data?.object?.id === subscription.id,
    );
  }, "cancellation receipt");
  const intents = await stripeApi(
    "/payment_intents?customer=" + customer.id + "&limit=20",
    null,
    "GET",
  );
  const paid = intents.data.find((i) => i.status === "succeeded");
  assert.ok(paid);
  await stripeApi("/refunds", { payment_intent: paid.id });
  await waitUntil(async () => {
    const { data } = await admin
      .from("orders")
      .select("status")
      .eq("id", order.id)
      .single();
    return data?.status === "refunded";
  }, "refund reflected in order");
  await waitUntil(async () => {
    const { data } = await admin
      .from("payment_events")
      .select("payload,processed_at")
      .eq("type", "charge.refunded");
    return data?.some(
      (e) =>
        e.processed_at && e.payload?.data?.object?.payment_intent === paid.id,
    );
  }, "refund webhook fully settled");
  const lifecycle = {
    initial_subscription: true,
    renewal: true,
    failed_renewal: true,
    cancellation: true,
    refund: true,
  };
  const receipt = {
    format: "starter3_stripe_network_v1",
    at: new Date().toISOString(),
    account: "BraveBrand LLC",
    test_mode: true,
    lifecycle,
    checkout_api: true,
    real_stripe_cli_delivery: true,
    checkout_applied: event.result,
    duplicate_refused: true,
    bad_signature_refused: true,
    limitations: [
      "CLI synthetic payment fixture, not a browser checkout",
      "out-of-order delivery and retry-after-processing-failure still pending",
    ],
  };
  writeFileSync(
    "/private/tmp/starter3-stripe-network-receipt.json",
    JSON.stringify(receipt, null, 2),
  );
  console.log(JSON.stringify(receipt));
} finally {
  app?.kill("SIGTERM");
  listener.kill("SIGTERM");
}
