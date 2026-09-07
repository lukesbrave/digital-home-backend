#!/usr/bin/env node
// Exercise the actual Worker entrypoint with a local OpenNext double. No network.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const tmp = mkdtempSync(join(tmpdir(), "social-feature-"));
try {
  const out = join(tmp, "worker.mjs");
  await build({ entryPoints: [join(root, "worker.ts")], outfile: out, bundle: true, platform: "node", format: "esm",
    plugins: [{ name: "local-open-next", setup(b) {
      b.onResolve({ filter: /\.open-next\/worker\.js$/ }, () => ({ path: "open-next-double", namespace: "double" }));
      b.onLoad({ filter: /.*/, namespace: "double" }, () => ({ contents: `
        export const DOQueueHandler = {}; export const DOShardedTagCache = {}; export const BucketCachePurge = {};
        export default { async fetch(request, env) { env.calls.push(new URL(request.url).pathname); return Response.json({ok:true}); } };
      ` }));
    } }], logLevel: "silent" });
  const worker = (await import(pathToFileURL(out).href)).default;
  for (const flag of ["false", "true", undefined]) {
    const env = { SOCIAL_PUBLISHING_ENABLED: flag, API_SECRET_KEY: "local-test-key", calls: [] };
    const pending = []; const ctx = { waitUntil(p) { pending.push(p); } };
    const response = await worker.fetch(new Request("https://local.test/api/social/posts/post-1/publish", {method:"POST"}), env, ctx);
    assert.equal(response.status, flag === "false" ? 403 : 200);
    env.calls.length = 0;
    await worker.scheduled({}, env, ctx); await Promise.all(pending);
    assert(env.calls.includes("/api/crm/tick"), "CRM must keep running");
    assert.equal(env.calls.includes("/api/social/tick"), flag !== "false");
  }
  const pageOut = join(tmp, "page.mjs");
  await build({ stdin: { contents: `import { createElement } from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import Layout from "./src/app/social/layout";
    export function render() {return renderToStaticMarkup(createElement(Layout, null, createElement("div", null, "ACTIVE_CALENDAR")));}`,
    resolveDir: root }, outfile:pageOut, bundle:true, platform:"node", format:"cjs", logLevel:"silent" });
  // CJS React server dependencies need a CJS extension.
  const { renameSync } = await import("node:fs"); const cjs = join(tmp, "page.cjs"); renameSync(pageOut,cjs);
  const page = await import(pathToFileURL(cjs).href);
  process.env.SOCIAL_PUBLISHING_ENABLED = "false";
  const disabled = page.render();
  assert(disabled.includes("Your social media calendar"));
  assert(disabled.includes("Ask Simon, your Digital Home Manager"));
  assert(!disabled.includes("ACTIVE_CALENDAR"));
  process.env.SOCIAL_PUBLISHING_ENABLED = "true";
  assert(page.render().includes("ACTIVE_CALENDAR"));
  console.log("PASS: Worker blocks social when off; CRM cron continues; legacy social enabled; inactive layout hides active children");
} finally { rmSync(tmp, {recursive:true,force:true}); }
