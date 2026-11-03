/** Helpers shared by the MCP tool handlers. Framework-free, like the handlers. */
import type { AdminClient } from "../../crm/types.ts";

export function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** An integer argument the schema already bounded, or the default. */
export function intArg(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.floor(value)
    : fallback;
}

/** A lead by lead_id or email, or a clear error. */
export async function resolveLead(
  supabase: AdminClient,
  args: Record<string, unknown>,
) {
  const id = str(args.lead_id);
  const email = str(args.email).toLowerCase();
  if (!id && !email) throw new Error("Pass lead_id or email");
  let query = supabase.from("leads").select("id, email, first_name, last_name");
  query = id ? query.eq("id", id) : query.eq("email", email);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`No lead found for ${id || email}`);
  return data;
}

export function leadName(lead: {
  email: string;
  first_name: string | null;
  last_name: string | null;
}): string {
  return (
    [lead.first_name, lead.last_name].filter(Boolean).join(" ") || lead.email
  );
}
