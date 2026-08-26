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
  isEnvelope,
  mergePlaybookRows,
  planPlaybookPublish,
  validatePlaybook,
  type BrandSettingRow,
  type StoredPlaybookEnvelope,
} from "./playbook-contract";

export {
  BRAND_ARCHIVE_PREFIX,
  BRAND_CURRENT_KEY,
  archiveSlug,
  isEnvelope,
  isRenderablePlaybook,
  mergePlaybookRows,
  planPlaybookPublish,
  playbookFingerprint,
  validatePlaybook,
  type BrandSettingRow,
  type PublishPlan,
  type StoredPlaybookEnvelope,
} from "./playbook-contract";

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
): Promise<{ current: StoredPlaybookEnvelope; archivedSlug?: string; changed: boolean }> {
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
  if (!plan.changed) return { current: plan.current, changed: false };

  if (plan.archive) {
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

  const { error: currentError } = await supabase.from("backend_settings").upsert(
    {
      key: BRAND_CURRENT_KEY,
      value: plan.current as unknown as Json,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" }
  );
  if (currentError) throw new Error(`Could not publish Brand Playbook: ${currentError.message}`);

  return {
    current: plan.current,
    archivedSlug: plan.archive?.slug,
    changed: true,
  };
}
