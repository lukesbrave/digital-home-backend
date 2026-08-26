import { createHash } from "node:crypto";
import type { Playbook, PlaybookEntry } from "../../../brand/playbooks/index";

export const BRAND_CURRENT_KEY = "brand_playbook:current";
export const BRAND_ARCHIVE_PREFIX = "brand_playbook:archive:";
export const BRAND_PROJECTION_SCHEMA = "brand-context.playbook.v1";

export const BRAND_PROJECTION_ROWS = [
  { key: "playbook_audience", category: "audience" },
  { key: "playbook_positioning", category: "positioning" },
  { key: "playbook_voice", category: "language" },
  { key: "playbook_standing_rules", category: "rules" },
  { key: "playbook_never_say", category: "language" },
  { key: "playbook_proof", category: "proof" },
  { key: "playbook_offer_core", category: "offer" },
] as const;

export const BRAND_PROJECTION_KEYS = BRAND_PROJECTION_ROWS.map((row) => row.key);

export type BrandContextProjectionRow = {
  key: (typeof BRAND_PROJECTION_ROWS)[number]["key"];
  category: (typeof BRAND_PROJECTION_ROWS)[number]["category"];
  content: string;
};

export type StoredPlaybookEnvelope = {
  schema: "brand-playbook.v1";
  slug: string;
  playbook: Playbook;
  publishedAt: string;
  publishedBy: string;
};

export type BrandSettingRow = {
  key: string;
  value: unknown;
  updated_at?: string;
};

export type PublishPlan = {
  current: StoredPlaybookEnvelope;
  archive?: StoredPlaybookEnvelope;
  changed: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isRenderablePlaybook(value: unknown): value is Playbook {
  if (!isRecord(value)) return false;
  const playbook = value as unknown as Playbook;
  return (
    typeof playbook.meta?.client === "string" &&
    typeof playbook.meta?.generatedAt === "string" &&
    typeof playbook.meta?.selectedAudience?.title === "string" &&
    typeof playbook.meta?.selectedAudience?.description === "string" &&
    typeof playbook.audienceResearch?.audienceState?.currentState === "string" &&
    typeof playbook.audienceResearch?.audienceState?.desiredState === "string" &&
    Array.isArray(playbook.audienceResearch?.painPoints) &&
    Array.isArray(playbook.audienceResearch?.languageMap?.painPhrases) &&
    Array.isArray(playbook.audienceResearch?.congregationPoints?.tier1_mainstream) &&
    Array.isArray(playbook.audienceResearch?.marketingRecommendation?.contentStrategyTips) &&
    Array.isArray(playbook.audienceResearch?.competitiveLandscape?.existingSolutions) &&
    typeof playbook.offerCore?.offerStatement?.finalStatement === "string" &&
    Array.isArray(playbook.offerCore?.theOfferGivesYou) &&
    Array.isArray(playbook.offerCore?.youCanUseItTo) &&
    Array.isArray(playbook.offerCore?.hiddenBenefits) &&
    Array.isArray(playbook.offerCore?.programNameOptions)
  );
}

export function validatePlaybook(value: unknown): string[] {
  if (isRenderablePlaybook(value)) return [];
  if (!isRecord(value)) return ["playbook must be a JSON object"];

  const errors: string[] = [];
  if (!isRecord(value.meta)) errors.push("meta is required");
  if (!isRecord(value.audienceResearch)) errors.push("audienceResearch is required");
  if (!isRecord(value.offerCore)) errors.push("offerCore is required");
  if (isRecord(value.meta) && typeof value.meta.client !== "string") {
    errors.push("meta.client must be a string");
  }
  if (isRecord(value.meta) && typeof value.meta.generatedAt !== "string") {
    errors.push("meta.generatedAt must be an ISO date string");
  }
  if (isRecord(value.offerCore) && !isRecord(value.offerCore.offerStatement)) {
    errors.push("offerCore.offerStatement is required");
  }

  return errors.length > 0
    ? errors
    : ["playbook does not satisfy the Brand shelf rendering contract"];
}

export function isEnvelope(value: unknown): value is StoredPlaybookEnvelope {
  if (!isRecord(value)) return false;
  return (
    value.schema === "brand-playbook.v1" &&
    typeof value.slug === "string" &&
    typeof value.publishedAt === "string" &&
    typeof value.publishedBy === "string" &&
    isRenderablePlaybook(value.playbook)
  );
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableValue(value[key])])
  );
}

function bullets(values: string[], empty: string): string {
  const cleaned = values.map((value) => String(value || "").trim()).filter(Boolean);
  return cleaned.length ? cleaned.map((value) => `- ${value}`).join("\n") : `- ${empty}`;
}

function narrativeNotes(
  values: { title: string; body: string }[] | undefined,
  empty: string
): string {
  if (!values?.length) return empty;
  return values.map((item) => `- ${item.title.trim()}: ${item.body.trim()}`).join("\n");
}

/** Deterministic projection owned by the Brand publisher. */
export function projectPlaybookToBrandContext(playbook: Playbook): BrandContextProjectionRow[] {
  const research = playbook.audienceResearch;
  const language = research.languageMap;
  const landscape = research.competitiveLandscape;
  const offer = playbook.offerCore;
  const rules = playbook.narrative?.standingCopyRules;
  const fallbackRules = research.marketingRecommendation.contentStrategyTips;
  const proof = playbook.narrative?.proofAsset;
  const programNames = offer.programNameOptions.map(
    (item) => `${item.name}: ${item.uniqueMechanism}. ${item.rationale}`
  );
  return [
    {
      key: "playbook_audience", category: "audience", content: [
        `Projection: ${BRAND_PROJECTION_SCHEMA}`,
        `Selected audience: ${playbook.meta.selectedAudience.title}`,
        playbook.meta.selectedAudience.description,
        `Current state: ${research.audienceState.currentState}`,
        `Desired state: ${research.audienceState.desiredState}`,
        "Pain points:",
        bullets(research.painPoints.map((item) => `${item.pain} (${item.severity}): ${item.emotionalContext}`), "No additional pain points were approved."),
      ].join("\n\n"),
    },
    {
      key: "playbook_positioning", category: "positioning", content: [
        `Urgent problem: ${research.urgencyGateway.problem}`,
        `Why now: ${research.urgencyGateway.whyUrgent}`,
        `Aspirin solution: ${research.urgencyGateway.aspirinSolution}`,
        "Failed solutions:", bullets(research.urgencyGateway.failedSolutions, "No failed solutions were recorded."),
        "Market gaps:", bullets(landscape.marketGaps, "No verified market gaps were recorded."),
        "Positioning opportunities:", bullets(landscape.positioningOpportunities, "No additional positioning opportunities were approved."),
      ].join("\n\n"),
    },
    {
      key: "playbook_voice", category: "language", content: [
        "Pain language:", bullets(language.painPhrases, "No pain phrases were recorded."),
        "Desire language:", bullets(language.desirePhrases, "No desire phrases were recorded."),
        "Emotional triggers:", bullets(language.emotionalTriggers, "No additional emotional triggers were recorded."),
      ].join("\n\n"),
    },
    {
      key: "playbook_standing_rules", category: "rules", content: rules?.length
        ? narrativeNotes(rules, "")
        : ["No separate standing-copy-rule block was approved. Use these approved content rules:", bullets(fallbackRules, "No additional content rules were recorded.")].join("\n\n"),
    },
    {
      key: "playbook_never_say", category: "language", content: bullets(playbook.narrative?.neverSay || [], "No brand-specific never-say list has been approved; never invent one."),
    },
    {
      key: "playbook_proof", category: "proof", content: proof
        ? `${proof.body.trim()}${proof.caution ? `\n\nCaution: ${proof.caution.trim()}` : ""}`
        : "No verified proof asset is recorded in the approved Playbook. Do not invent proof.",
    },
    {
      key: "playbook_offer_core", category: "offer", content: [
        `Offer statement: ${offer.offerStatement.finalStatement}`,
        offer.offerStatement.emotionalCore ? `Emotional core: ${offer.offerStatement.emotionalCore}` : "Emotional core: No separate emotional-core line was approved.",
        "The offer gives the buyer:", bullets(offer.theOfferGivesYou, "No additional give-you claims were approved."),
        "They can use it to:", bullets(offer.youCanUseItTo, "No additional use cases were approved."),
        "Hidden benefits:", bullets(offer.hiddenBenefits, "No additional hidden benefits were approved."),
        "Approved programme-name options (strategic names, not active products):", bullets(programNames, "No programme-name options were approved."),
      ].join("\n\n"),
    },
  ];
}

export function playbookFingerprint(playbook: Playbook): string {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(playbook)))
    .digest("hex");
}

export function comparePlaybookProjection(
  playbook: Playbook,
  rows: { key: string; category: string; content: string }[]
) {
  const expected = projectPlaybookToBrandContext(playbook);
  const current = new Map(rows.map((row) => [row.key, row]));
  const missing = expected.filter((row) => !current.has(row.key)).map((row) => row.key);
  const stale = expected.filter((row) => {
    const actual = current.get(row.key);
    return actual && (actual.category !== row.category || actual.content !== row.content);
  }).map((row) => row.key);
  return {
    ready: missing.length === 0 && stale.length === 0,
    fingerprint: playbookFingerprint(playbook),
    rows: expected.length,
    missing,
    stale,
  };
}

function slugPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "playbook";
}

export function archiveSlug(playbook: Playbook): string {
  const date = /^\d{4}-\d{2}-\d{2}/.exec(playbook.meta.generatedAt)?.[0] || "undated";
  return `${date}-${slugPart(playbook.meta.client)}-${playbookFingerprint(playbook).slice(0, 8)}`;
}

export function mergePlaybookRows(
  rows: BrandSettingRow[],
  bundled: PlaybookEntry[]
): PlaybookEntry[] {
  const envelopes = rows.map((row) => row.value).filter(isEnvelope);
  const liveCurrent = envelopes.find((entry) => entry.slug === "current");
  const archives = envelopes
    .filter((entry) => entry.slug !== "current")
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

  const entries: PlaybookEntry[] = liveCurrent
    ? [{ slug: "current", playbook: liveCurrent.playbook }]
    : bundled.slice(0, 1);
  const seen = new Set(entries.map((entry) => playbookFingerprint(entry.playbook)));

  for (const envelope of archives) {
    const fingerprint = playbookFingerprint(envelope.playbook);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    entries.push({ slug: envelope.slug, playbook: envelope.playbook });
  }

  if (!liveCurrent) {
    for (const entry of bundled.slice(1)) {
      const fingerprint = playbookFingerprint(entry.playbook);
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      entries.push(entry);
    }
  }

  return entries;
}

export function planPlaybookPublish(args: {
  next: Playbook;
  existing?: StoredPlaybookEnvelope;
  bundled?: Playbook;
  actor: string;
  now: string;
}): PublishPlan {
  const nextFingerprint = playbookFingerprint(args.next);
  if (args.existing && playbookFingerprint(args.existing.playbook) === nextFingerprint) {
    return { current: args.existing, changed: false };
  }

  const previous = args.existing?.playbook || args.bundled;
  const currentEnvelope: StoredPlaybookEnvelope = {
    schema: "brand-playbook.v1",
    slug: "current",
    playbook: args.next,
    publishedAt: args.now,
    publishedBy: args.actor,
  };

  if (!previous || playbookFingerprint(previous) === nextFingerprint) {
    return { current: currentEnvelope, changed: true };
  }

  const previousSlug = archiveSlug(previous);
  return {
    current: currentEnvelope,
    archive: {
      schema: "brand-playbook.v1",
      slug: previousSlug,
      playbook: previous,
      publishedAt: args.existing?.publishedAt || previous.meta.generatedAt,
      publishedBy: args.existing?.publishedBy || "bundled-source",
    },
    changed: true,
  };
}
