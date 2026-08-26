#!/usr/bin/env node
/** Publish and verify the scoped Brand Playbook shelf without deploying the app. */
import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(projectRoot, ".env.local");
const env = {};
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (match) env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, "");
  }
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const command = process.argv[2];
const base = (option("base") || process.env.BACKEND_URL || env.BACKEND_URL || "http://localhost:3001").replace(/\/$/, "");
const apiKey = process.env.API_SECRET_KEY || env.API_SECRET_KEY;
const signingSecret = process.env.API_REQUEST_SIGNING_SECRET || env.API_REQUEST_SIGNING_SECRET || apiKey;

if (!apiKey || !signingSecret) {
  console.error("API_SECRET_KEY (and API_REQUEST_SIGNING_SECRET if different) must exist in .env.local or the environment.");
  process.exit(1);
}

async function api(method, path, body) {
  const bodyText = body === undefined ? "" : JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", signingSecret)
    .update(`${method}:${path}:${timestamp}:${bodyText}`)
    .digest("hex");
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "user-agent": "Digital-Home-Brand-Publisher/1.0",
      "x-api-key": apiKey,
      "x-timestamp": timestamp,
      "x-signature": signature,
    },
    body: bodyText || undefined,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${path} returned ${response.status}: ${json.error || JSON.stringify(json)}`);
  return json;
}

if (command === "check") {
  const result = await api("GET", "/api/brand/playbooks");
  console.log(JSON.stringify({ ready: result.ready === true, base, current: result.current?.playbook?.meta || null }, null, 2));
  process.exit(result.ready === true ? 0 : 1);
}

if (command !== "publish") {
  console.error("Usage: node scripts/publish-brand-playbook.mjs check|publish [--file brand/playbook.json] [--base https://backend.example.com] [--actor tumi]");
  process.exit(1);
}

const file = resolve(projectRoot, option("file") || "brand/playbook.json");
const playbook = JSON.parse(readFileSync(file, "utf8"));
const actor = option("actor") || "tumi";
const published = await api("POST", "/api/brand/playbooks", { playbook, actor });
const verified = await api("GET", "/api/brand/playbooks");
const expected = playbook.meta || {};
const actual = verified.current?.playbook?.meta || {};
if (actual.client !== expected.client || actual.generatedAt !== expected.generatedAt || actual.version !== expected.version) {
  throw new Error("Publish returned success, but the live Brand shelf did not match the source playbook metadata.");
}

console.log(JSON.stringify({
  success: true,
  changed: published.changed,
  client: actual.client,
  generatedAt: actual.generatedAt,
  archivedSlug: published.archivedSlug,
  live: `${base}${published.brandPath}`,
}, null, 2));
