import assert from "node:assert/strict";
import test from "node:test";
import {
  BRAND_PROJECTION_KEYS,
  comparePlaybookProjection,
  mergePlaybookRows,
  planPlaybookPublish,
  projectPlaybookToBrandContext,
  validatePlaybook,
  type StoredPlaybookEnvelope,
} from "./playbook-contract.ts";
import type { Playbook } from "../../../brand/playbooks/index.ts";

function fixture(client: string, generatedAt = "2026-08-26T00:00:00.000Z"): Playbook {
  return {
    meta: {
      client,
      generatedAt,
      version: "2.0-agent",
      selectedAudience: { title: "Builders", description: "Independent builders" },
    },
    audienceResearch: {
      audienceState: { currentState: "Stuck", desiredState: "Growing" },
      urgencyGateway: { problem: "Capacity", whyUrgent: "Now", failedSolutions: [], aspirinSolution: "System" },
      painPoints: [],
      languageMap: { painPhrases: [], desirePhrases: [], searchPhrases: [], emotionalTriggers: [] },
      congregationPoints: { tier1_mainstream: [], tier2_niche: [], tier3_micro: [] },
      marketingRecommendation: {
        primaryPlatform: { platform: "Email", reasoning: "Owned", contentFormats: [] },
        contentStrategyTips: [],
        quickWin: "Send",
      },
      competitiveLandscape: { existingSolutions: [], marketGaps: [], positioningOpportunities: [] },
    },
    offerCore: {
      offerStatement: { finalStatement: "A clear offer" },
      theOfferGivesYou: [],
      youCanUseItTo: [],
      hiddenBenefits: [],
      programNameOptions: [],
    },
  };
}

function envelope(playbook: Playbook, slug = "current"): StoredPlaybookEnvelope {
  return {
    schema: "brand-playbook.v1",
    slug,
    playbook,
    publishedAt: playbook.meta.generatedAt,
    publishedBy: "agent:tumi",
  };
}

test("empty playbooks are rejected before publication", () => {
  assert.ok(validatePlaybook({}).length > 0);
});

test("a renderable playbook satisfies the live shelf contract", () => {
  assert.deepEqual(validatePlaybook(fixture("Acme")), []);
});

test("live current wins and archives are de-duplicated", () => {
  const live = fixture("Live");
  const old = fixture("Old", "2026-08-20T00:00:00.000Z");
  const entries = mergePlaybookRows(
    [
      { key: "brand_playbook:current", value: envelope(live) },
      { key: "brand_playbook:archive:old", value: envelope(old, "old") },
      { key: "brand_playbook:archive:duplicate", value: envelope(old, "duplicate") },
    ],
    [{ slug: "current", playbook: fixture("Bundled") }]
  );
  assert.deepEqual(entries.map((entry) => entry.playbook.meta.client), ["Live", "Old"]);
});

test("first publish into an empty shelf creates no archive", () => {
  const plan = planPlaybookPublish({ next: fixture("New"), actor: "agent:tumi", now: "2026-08-26T01:00:00Z" });
  assert.equal(plan.changed, true);
  assert.equal(plan.archive, undefined);
});

test("replacing a current playbook archives the previous edition", () => {
  const old = fixture("Old", "2026-08-20T00:00:00Z");
  const plan = planPlaybookPublish({
    next: fixture("New"),
    existing: envelope(old),
    actor: "agent:tumi",
    now: "2026-08-26T01:00:00Z",
  });
  assert.equal(plan.archive?.playbook.meta.client, "Old");
  assert.match(plan.archive?.slug || "", /^2026-08-20-old-/);
});

test("re-publishing identical research is idempotent", () => {
  const playbook = fixture("Same");
  const existing = envelope(playbook);
  const plan = planPlaybookPublish({
    next: playbook,
    existing,
    actor: "agent:tumi",
    now: "2026-08-26T01:00:00Z",
  });
  assert.equal(plan.changed, false);
  assert.equal(plan.current, existing);
  assert.equal(plan.archive, undefined);
});

test("Playbook projection is deterministic, complete, and owns only namespaced rows", () => {
  const playbook = fixture("Projection");
  playbook.narrative = {
    standingCopyRules: [{ title: "Plain", body: "Use short direct sentences." }],
    proofAsset: { body: "Verified client result", caution: "Re-check before quoting." },
    knownGaps: [],
    neverSay: ["revolutionary"],
  };
  const first = projectPlaybookToBrandContext(playbook);
  assert.deepEqual(first, projectPlaybookToBrandContext(playbook));
  assert.deepEqual(first.map((row) => row.key), BRAND_PROJECTION_KEYS);
  assert.equal(first.length, 7);
  assert(first.every((row) => row.content.trim().length > 0));
  assert(first.some((row) => row.content.includes("Verified client result")));
  assert(first.some((row) => row.content.includes("revolutionary")));
  assert(!BRAND_PROJECTION_KEYS.includes("links" as never));
  assert(!BRAND_PROJECTION_KEYS.includes("author" as never));
  assert(!BRAND_PROJECTION_KEYS.includes("image_style" as never));
});

test("projection comparison detects missing and stale rows and accepts an idempotent repair", () => {
  const playbook = fixture("Repair");
  const expected = projectPlaybookToBrandContext(playbook);
  const missing = comparePlaybookProjection(playbook, expected.slice(1));
  assert.equal(missing.ready, false);
  assert.deepEqual(missing.missing, [expected[0].key]);
  const staleRows = expected.map((row, index) => index === 1 ? { ...row, content: `${row.content}\nstale` } : row);
  const stale = comparePlaybookProjection(playbook, staleRows);
  assert.equal(stale.ready, false);
  assert.deepEqual(stale.stale, [expected[1].key]);
  const repaired = comparePlaybookProjection(playbook, expected);
  assert.equal(repaired.ready, true);
  assert.deepEqual(repaired.missing, []);
  assert.deepEqual(repaired.stale, []);
});
