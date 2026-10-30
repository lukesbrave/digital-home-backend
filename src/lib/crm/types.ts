import type { createAdminClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database";

export type AdminClient = ReturnType<typeof createAdminClient>;

export type Lead = Tables<"leads">;
export type Workflow = Tables<"workflows">;
export type Enrollment = Tables<"workflow_enrollments">;
export type EmailTemplate = Tables<"email_templates">;

export type WorkflowStepType =
  | "send_email"
  | "wait"
  | "add_tag"
  | "remove_tag"
  | "set_status"
  | "move_stage"
  | "update_field"
  | "webhook"
  | "create_task";

export interface WorkflowStep {
  id: string;
  type: WorkflowStepType;
  config: Record<string, unknown>;
}

export type TriggerType =
  | "engagement_stage_changed"
  | "manual"
  | "lead_created"
  | "form_submitted"
  | "tag_added"
  | "status_changed"
  | "stage_changed";

export interface SendWindow {
  enabled: boolean;
  start_hour: number;
  end_hour: number;
  timezone: string;
  days: number[]; // 0 = Sunday … 6 = Saturday
}

export interface CrmSender {
  from_name: string;
  from_email: string;
  reply_to?: string;
  address?: string; // physical address for the email footer (CAN-SPAM)
}

export interface SendBudget {
  enabled: boolean;
  daily_limit: number; // max emails accepted per UTC day across all workflows
  per_tick_limit: number; // max emails per engine tick — smooths bursts within the day
  max_bounce_rate: number; // circuit breaker: pause sends when rolling-24h bounce rate exceeds this (0–1)
  max_complaint_rate: number; // circuit breaker: pause sends when rolling-24h complaint rate exceeds this (0–1)
  breaker_min_sends: number; // breaker only arms once this many sends landed in the window
  // Activation-critical workflows the daily cap and the breaker must never
  // pause. These still count against the budget and still respect the send
  // window — they just don't get parked when a bulk campaign misbehaves.
  exempt_workflow_ids: string[];
  // Lead tags that make an address unsendable. Until 2026-07-27 the
  // `suppressed-dead-list` tag was decorative — the sender only ever checked
  // email_status — so a list marked "suppressed" kept being mailed and kept
  // hard-bouncing. Tagging is the obvious way to retire a list, so the tag
  // now has to actually do it.
  suppress_tags: string[];
}

export interface CrmSettings {
  safe_mode: boolean;
  sender: CrmSender;
  send_window: SendWindow;
  send_budget: SendBudget;
  capture_key: string | null;
  funnel_secret: string | null;
}

export const WORKFLOW_STEP_TYPES: WorkflowStepType[] = [
  "send_email",
  "wait",
  "add_tag",
  "remove_tag",
  "set_status",
  "move_stage",
  "update_field",
  "webhook",
  "create_task",
];

export function parseSteps(raw: unknown): WorkflowStep[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (s): s is WorkflowStep =>
      !!s && typeof s === "object" && typeof (s as WorkflowStep).type === "string"
  );
}
