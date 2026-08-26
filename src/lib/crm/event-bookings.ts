/**
 * Paid bookings → the pipeline ledger.
 *
 * When a payment webhook (e.g. Stripe on the Digital Home frontend) captures
 * a lead with custom.booking_amount_cents, the money used to stop there —
 * recorded on the LEAD but invisible to every revenue number. This turns the
 * booking into a WON opportunity at the booking amount.
 *
 * Test-mode sessions are ignored; idempotent per Stripe session (the deal
 * name carries the session tail); fail-soft — a pipeline write must never
 * fail a capture.
 */
import type { AdminClient, Lead } from "@/lib/crm/types";

export async function winEventBookingDeal(
  supabase: AdminClient,
  lead: Lead,
  custom: Record<string, unknown>
): Promise<{ opportunity_id: string; action: "won" | "created_won" } | undefined> {
  try {
    const cents = Number(custom.booking_amount_cents ?? 0);
    if (!cents || cents <= 0) return undefined;
    if (custom.test === true) return undefined;
    const session = typeof custom.stripe_session_id === "string" ? custom.stripe_session_id : "";
    if (session.startsWith("cs_test")) return undefined;

    const eventName = typeof custom.event_name === "string" && custom.event_name ? custom.event_name : "Event booking";
    const name = `${eventName} — ${session ? session.slice(-8) : lead.email}`;

    const { data: existing } = await supabase
      .from("opportunities")
      .select("id")
      .eq("lead_id", lead.id)
      .eq("name", name)
      .limit(1);
    if (existing?.length) return { opportunity_id: existing[0].id, action: "won" };

    // Landing stage: a stage named in settings (crm_won_stage_name) when
    // configured, otherwise the pipeline's last stage. Status "won" is what
    // matters for the numbers either way.
    const { data: stages } = await supabase
      .from("pipeline_stages")
      .select("id, name, pipeline_id")
      .order("position");
    if (!stages?.length) return undefined;
    const { data: cfg } = await supabase
      .from("backend_settings")
      .select("value")
      .eq("key", "crm_won_stage_name")
      .maybeSingle();
    const wanted = typeof cfg?.value === "string" ? cfg.value.toLowerCase() : null;
    const stage = (wanted && stages.find((s) => s.name.toLowerCase() === wanted)) || stages[stages.length - 1];

    const bookedAt = typeof custom.booked_at === "string" && custom.booked_at ? custom.booked_at : new Date().toISOString();
    const { data: created } = await supabase
      .from("opportunities")
      .insert({
        lead_id: lead.id,
        pipeline_id: stage.pipeline_id,
        stage_id: stage.id,
        name,
        status: "won",
        won_at: bookedAt,
        value_cents: cents,
      })
      .select("id")
      .single();
    return created ? { opportunity_id: created.id, action: "created_won" } : undefined;
  } catch (e) {
    console.error("winEventBookingDeal failed", e);
    return undefined;
  }
}
