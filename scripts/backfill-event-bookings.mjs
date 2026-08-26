#!/usr/bin/env node
/**
 * backfill-event-bookings.mjs — one-time repair: paid event bookings that
 * landed on LEADS (custom.booking_amount_cents, via the site's Stripe flow)
 * but never became won opportunities get their deal recorded now, at the
 * booking amount, won_at = booked_at. Test-mode bookings are skipped.
 * Idempotent — same naming contract as winEventBookingDeal, safe to re-run.
 *
 *   node --env-file=.env.local scripts/backfill-event-bookings.mjs [--dry]
 */
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const dry = process.argv.includes("--dry");

const { data: leads, error } = await supabase
  .from("leads")
  .select("id, email, first_name, last_name, custom")
  .gt("custom->>booking_amount_cents", 0)
  .limit(500);
if (error) throw error;

const { data: stages } = await supabase.from("pipeline_stages").select("id, name, pipeline_id").order("position");
const { data: cfg } = await supabase.from("backend_settings").select("value").eq("key", "crm_won_stage_name").maybeSingle();
const wanted = typeof cfg?.value === "string" ? cfg.value.toLowerCase() : null;
const stage = (wanted && stages?.find((s) => s.name.toLowerCase() === wanted)) || stages?.[stages.length - 1];
if (!stage) throw new Error("No pipeline stages found");

let created = 0, skipped = 0, total = 0;
for (const lead of leads ?? []) {
  const c = lead.custom ?? {};
  const cents = Number(c.booking_amount_cents ?? 0);
  const session = String(c.stripe_session_id ?? "");
  if (!cents || c.test === true || session.startsWith("cs_test")) { skipped++; continue; }

  const eventName = c.event_name || "Event booking";
  const name = `${eventName} — ${session ? session.slice(-8) : lead.email}`;
  const { data: existing } = await supabase
    .from("opportunities").select("id").eq("lead_id", lead.id).eq("name", name).limit(1);
  if (existing?.length) { skipped++; continue; }

  console.log(`${dry ? "[dry] " : ""}+ $${(cents / 100).toFixed(0)}  ${lead.email}  (${name})`);
  total += cents;
  if (!dry) {
    const { error: insErr } = await supabase.from("opportunities").insert({
      lead_id: lead.id,
      pipeline_id: stage.pipeline_id,
      stage_id: stage.id,
      name,
      status: "won",
      won_at: c.booked_at || new Date().toISOString(),
      value_cents: cents,
    });
    if (insErr) { console.error(`  ✗ ${insErr.message}`); continue; }
  }
  created++;
}
console.log(`\n${dry ? "[dry] would create" : "created"} ${created} won deals ($${(total / 100).toLocaleString()}), skipped ${skipped}`);
