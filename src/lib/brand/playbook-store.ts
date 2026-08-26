import current from "../../../brand/playbook.json";
import {
  PLAYBOOKS as BUNDLED_PLAYBOOKS,
  isPlaybook,
  type Playbook,
  type PlaybookEntry,
} from "../../../brand/playbooks";
import { createAdminClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";
import {
  BRAND_ARCHIVE_PREFIX,
  BRAND_CURRENT_KEY,
  BRAND_PROJECTION_KEYS,
  comparePlaybookProjection,
  isEnvelope,
  mergePlaybookRows,
  planPlaybookPublish,
  projectPlaybookToBrandContext,
  validatePlaybook,
  type BrandSettingRow,
  type StoredPlaybookEnvelope,
} from "./playbook-contract";

export {
  BRAND_ARCHIVE_PREFIX,
  BRAND_CURRENT_KEY,
  BRAND_PROJECTION_KEYS,
  BRAND_PROJECTION_ROWS,
  BRAND_PROJECTION_SCHEMA,
  archiveSlug,
  isEnvelope,
  isRenderablePlaybook,
  mergePlaybookRows,
  planPlaybookPublish,
  playbookFingerprint,
  projectPlaybookToBrandContext,
  validatePlaybook,
  type BrandSettingRow,
  type PublishPlan,
  type StoredPlaybookEnvelope,
} from "./playbook-contract";

export type BrandProjectionStatus = {
  ready: boolean;
  fingerprint: string;
  rows: number;
  missing: string[];
  stale: string[];
};

export type BrandOperationalReadiness = {
  article_cta_ready: boolean;
  active_offers: number;
  cta_links_configured: boolean;
  fault: string | null;
  message: string | null;
};

function bundledCurrent(): Playbook | undefined {
  return isPlaybook(current) ? current : undefined;
}

export async function assertBrandPublisherReady(): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("backend_settings")
    .select("key")
    .like("key", "brand_playbook:%")
    .limit(1);
  if (error) throw new Error(`Brand shelf database is not ready: ${error.message}`);
  const { error: contextError } = await supabase.from("brand_context").select("key").limit(1);
  if (contextError) throw new Error(`Brand downstream context is not ready: ${contextError.message}`);
}

export async function inspectBrandProjection(playbook: Playbook): Promise<BrandProjectionStatus> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("brand_context")
    .select("key, category, content")
    .in("key", BRAND_PROJECTION_KEYS);
  if (error) throw new Error(`Could not inspect Brand projection: ${error.message}`);
  return comparePlaybookProjection(playbook, data || []);
}

async function syncBrandProjection(
  playbook: Playbook
): Promise<BrandProjectionStatus & { changed: boolean }> {
  const supabase = createAdminClient();
  const expected = projectPlaybookToBrandContext(playbook);
  const { data, error } = await supabase
    .from("brand_context")
    .select("key, category, content")
    .in("key", BRAND_PROJECTION_KEYS);
  if (error) throw new Error(`Could not read Brand projection: ${error.message}`);
  const before = comparePlaybookProjection(playbook, data || []);
  if (!before.ready) {
    const { error: projectionError } = await supabase
      .from("brand_context")
      .upsert(expected, { onConflict: "key" });
    if (projectionError) throw new Error(`Could not synchronize Brand projection: ${projectionError.message}`);
  }
  return { ...comparePlaybookProjection(playbook, expected), changed: !before.ready };
}

export async function getBrandOperationalReadiness(): Promise<BrandOperationalReadiness> {
  const supabase = createAdminClient();
  const [ctaResult, offersResult] = await Promise.all([
    supabase.from("brand_context").select("content").eq("category", "cta").eq("key", "links").maybeSingle(),
    supabase.from("offers").select("id", { count: "exact", head: true }).eq("status", "active"),
  ]);
  const fault = ctaResult.error
    ? `cta/links check failed: ${ctaResult.error.message}`
    : offersResult.error
      ? `active offers check failed: ${offersResult.error.message}`
      : null;
  const ctaLinksConfigured = Boolean(ctaResult.data?.content?.trim());
  const activeOffers = offersResult.count || 0;
  const ready = !fault && (ctaLinksConfigured || activeOffers > 0);
  return {
    article_cta_ready: ready,
    active_offers: activeOffers,
    cta_links_configured: ctaLinksConfigured,
    fault,
    message: ready ? null : fault || "No active offer or configured CTA link. Drafting may continue without an invented destination; publication needs a human-approved no-link CTA or a configured operational destination.",
  };
}

export async function loadBrandPlaybooks(): Promise<PlaybookEntry[]> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("backend_settings")
      .select("key, value, updated_at")
      .like("key", "brand_playbook:%");
    if (error) throw error;
    return mergePlaybookRows((data || []) as BrandSettingRow[], BUNDLED_PLAYBOOKS);
  } catch (error) {
    console.error("Brand shelf database read failed; using bundled playbooks", error);
    return BUNDLED_PLAYBOOKS;
  }
}

export async function getBrandPlaybook(slug: string): Promise<Playbook | undefined> {
  const entries = await loadBrandPlaybooks();
  return entries.find((entry) => entry.slug === slug)?.playbook;
}

export async function publishBrandPlaybook(
  playbook: Playbook,
  actor: string
): Promise<{
  current: StoredPlaybookEnvelope;
  archivedSlug?: string;
  changed: boolean;
  projection: BrandProjectionStatus & { changed: boolean };
}> {
  const validationErrors = validatePlaybook(playbook);
  if (validationErrors.length > 0) {
    throw new Error(`Invalid Brand Playbook: ${validationErrors.join("; ")}`);
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("backend_settings")
    .select("value")
    .eq("key", BRAND_CURRENT_KEY)
    .maybeSingle();
  if (error) throw new Error(`Could not read current Brand Playbook: ${error.message}`);

  const existing = isEnvelope(data?.value) ? data.value : undefined;
  const plan = planPlaybookPublish({
    next: playbook,
    existing,
    bundled: bundledCurrent(),
    actor,
    now: new Date().toISOString(),
  });
  if (plan.changed && plan.archive) {
    const { error: archiveError } = await supabase.from("backend_settings").upsert(
      {
        key: `${BRAND_ARCHIVE_PREFIX}${plan.archive.slug}`,
        value: plan.archive as unknown as Json,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    );
    if (archiveError) {
      throw new Error(`Could not archive previous Brand Playbook: ${archiveError.message}`);
    }
  }

  if (plan.changed) {
    const { error: currentError } = await supabase.from("backend_settings").upsert(
      {
        key: BRAND_CURRENT_KEY,
        value: plan.current as unknown as Json,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    );
    if (currentError) throw new Error(`Could not publish Brand Playbook: ${currentError.message}`);
  }

  const projection = await syncBrandProjection(playbook);

  return {
    current: plan.current,
    archivedSlug: plan.archive?.slug,
    changed: plan.changed,
    projection,
  };
}
