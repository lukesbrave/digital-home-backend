import { logActivity } from "./activity";
import { validUuidValues } from "./capture-validation";
import { fireTrigger } from "./engine";
import type { AdminClient, Lead } from "./types";
import type { Json } from "@/types/database";

export interface LeadInput {
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null; // "Full Name" convenience — split if first/last absent
  phone?: string | null;
  company?: string | null;
  source?: string | null;
  capture_page?: string | null;
  form?: string | null; // form identifier for form_submitted triggers
  message?: string | null; // free-text message → saved as a note
  tags?: string[];
  interested_offers?: string[];
  custom?: Record<string, unknown>;
  timezone?: string | null;
}

export interface UpsertResult {
  lead: Lead;
  created: boolean;
  /** The lead's state BEFORE this upsert merged into it; undefined when created. */
  previous?: Lead;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function splitName(name: string): { first: string; last: string | null } {
  const parts = name.trim().split(/\s+/);
  return { first: parts[0], last: parts.length > 1 ? parts.slice(1).join(" ") : null };
}

/**
 * Creates or updates a lead by email. New data fills gaps (never overwrites
 * existing values with blanks), tags are unioned, custom fields merged.
 * Fires lead_created / form_submitted / tag_added triggers unless disabled
 * (imports should pass fireTriggers: false so old contacts don't get welcome
 * sequences).
 */
export async function upsertLead(
  supabase: AdminClient,
  input: LeadInput,
  opts: { actor?: string; fireTriggers?: boolean } = {}
): Promise<UpsertResult> {
  const actor = opts.actor ?? "system";
  const fire = opts.fireTriggers !== false;
  const email = normalizeEmail(input.email);

  let first_name = input.first_name?.trim() || null;
  let last_name = input.last_name?.trim() || null;
  if (!first_name && input.name?.trim()) {
    const split = splitName(input.name);
    first_name = split.first;
    last_name = last_name || split.last;
  }

  const cleanTags = (input.tags || []).map((t) => t.trim()).filter(Boolean);
  const cleanOffers = validUuidValues(input.interested_offers);

  // Case-insensitive lookup: the unique constraint on email is effectively
  // case-insensitive, but some older rows carry mixed-case emails — an .eq()
  // miss here would insert a duplicate and hit the constraint instead.
  const { data: existing, error: lookupError } = await supabase
    .from("leads")
    .select("*")
    .ilike("email", email.replace(/[%_]/g, "\\$&"))
    .limit(1)
    .maybeSingle();
  if (lookupError) throw new Error(`lead lookup failed: ${lookupError.message}`);

  let lead: Lead;
  let created = false;
  let addedTags: string[] = [];

  if (existing) {
    const mergedTags = Array.from(new Set([...(existing.tags || []), ...cleanTags]));
    const mergedOffers = Array.from(
      new Set([...(existing.interested_offers || []), ...cleanOffers])
    );
    addedTags = mergedTags.filter((t) => !(existing.tags || []).includes(t));
    const mergedCustom = {
      ...((existing.custom as Record<string, unknown>) || {}),
      ...(input.custom || {}),
    };

    const { data: updated, error } = await supabase
      .from("leads")
      .update({
        first_name: existing.first_name || first_name,
        last_name: existing.last_name || last_name,
        phone: existing.phone || input.phone?.trim() || null,
        company: existing.company || input.company?.trim() || null,
        timezone: existing.timezone || input.timezone || null,
        tags: mergedTags,
        interested_offers: mergedOffers,
        custom: mergedCustom as Json,
        last_activity_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error || !updated) throw new Error(`lead update failed: ${error?.message}`);
    lead = updated;
  } else {
    const { data: inserted, error } = await supabase
      .from("leads")
      .insert({
        email,
        first_name,
        last_name,
        phone: input.phone?.trim() || null,
        company: input.company?.trim() || null,
        source: input.source || input.form || null,
        capture_page: input.capture_page || null,
        timezone: input.timezone || null,
        tags: cleanTags,
        interested_offers: cleanOffers,
        custom: (input.custom || {}) as Json,
      })
      .select("*")
      .single();
    if (error || !inserted) throw new Error(`lead insert failed: ${error?.message}`);
    lead = inserted;
    created = true;
    addedTags = cleanTags;

    await logActivity(supabase, {
      lead_id: lead.id,
      activity_type: "created",
      title: `Lead created${input.source ? ` via ${input.source}` : ""}`,
      data: { source: input.source, capture_page: input.capture_page },
      actor,
    });
  }

  if (input.message?.trim()) {
    await logActivity(supabase, {
      lead_id: lead.id,
      activity_type: "note",
      title: "Message from form",
      body: input.message.trim(),
      data: { form: input.form },
      actor,
    });
  }

  if (input.form || (!created && input.source)) {
    await logActivity(supabase, {
      lead_id: lead.id,
      activity_type: "form_submitted",
      title: `Form submitted: ${input.form || input.source}`,
      data: { form: input.form || input.source, capture_page: input.capture_page },
      actor,
    });
  }

  if (fire) {
    if (created) {
      await fireTrigger(supabase, { type: "lead_created", lead, data: { source: lead.source } });
    }
    if (input.form || input.source) {
      await fireTrigger(supabase, {
        type: "form_submitted",
        lead,
        data: { form: input.form || input.source },
      });
    }
    for (const tag of addedTags) {
      await fireTrigger(supabase, { type: "tag_added", lead, data: { tag } });
    }
  }

  return { lead, created, previous: created ? undefined : (existing as Lead) };
}
