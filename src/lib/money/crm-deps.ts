/**
 * The real MoneyDeps: the CRM's own lead, trigger and enrolment functions.
 * Routes pass this; tests pass fakes.
 */
import { upsertLead } from "@/lib/crm/leads";
import { enrollLead, fireTrigger } from "@/lib/crm/engine";
import type { AdminClient } from "@/lib/crm/types";
import type { MoneyDeps } from "./deps";

const admin = (db: unknown) => db as AdminClient;

export const crmDeps: MoneyDeps = {
  upsertLead: (db, input, opts) => upsertLead(admin(db), input, opts),
  fireTrigger: (db, event) => fireTrigger(admin(db), event),
  enrollLead: (db, workflow, lead, source) => enrollLead(admin(db), workflow, lead, source),
};
