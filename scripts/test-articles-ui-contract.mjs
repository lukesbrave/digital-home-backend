#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const page = readFileSync(resolve(root, "src/app/content/page.tsx"), "utf8");
const sidebar = readFileSync(resolve(root, "src/components/sidebar.tsx"), "utf8");
const articlesApi = readFileSync(resolve(root, "src/app/api/articles/route.ts"), "utf8");

assert.match(sidebar, /href: '\/content',\s*label: 'Articles'/);
assert.match(page, /view === 'board' \? 'Pipeline' : 'Published'/);
assert.match(page, />\s*Published\s*<\/button>/);
assert.match(page, /fetch\('\/api\/articles\?status=published'\)/);
assert.match(page, /No published articles yet\./);
assert.match(page, /isNew \? 'pr-14' : ''/);
assert.equal((page.match(/isNew \? 'pr-14' : ''/g) || []).length, 2);
assert.match(articlesApi, /query = query\.eq\("status", status/);

console.log(
  JSON.stringify(
    {
      ok: true,
      navigation: "Articles > Pipeline | Published",
      published_view: "requests published rows only",
      new_badge: "title reserves right-side badge space",
      route: "/content preserved",
    },
    null,
    2
  )
);
