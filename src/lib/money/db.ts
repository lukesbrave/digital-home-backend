/** The shared service-role client, including the money tables. */
import { createAdminClient } from "@/lib/supabase/server";
import type { AdminClient } from "@/lib/crm/types";

export type MoneyClient = AdminClient;

export function moneyDb(supabase: AdminClient = createAdminClient()): MoneyClient {
  return supabase;
}
