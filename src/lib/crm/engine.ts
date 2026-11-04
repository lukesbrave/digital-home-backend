import { onDealWon } from "@/lib/money/engagements";
import { moneyDb } from "@/lib/money/db";
import { isDealWon } from "@/lib/money/state";
import { logActivity } from "./activity";
import { sendCrmEmail } from "./email";
import { getCrmSettings } from "./settings";
import { renderMergeTags } from "./merge";
import { recomputeLeadScores } from "./scoring";
import { alertHotLeads } from "./alerts";
import { promoteSubjectTests } from "./abtest";
import { sendBookingReminders } from "./bookings";
import { runHealthChecks } from "./health";
import type {
  AdminClient,
  CrmSettings,
  Enrollment,
  Lead,
  SendWindow,
  TriggerType,
  Workflow,
  WorkflowStep,
} from "./types";
import { parseSteps } from "./types";
import type { Json } from "@/types/database";

const MAX_STEPS_PER_TICK = 25; // per enrollment — guards against runaway loops
const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 30 * 60 * 1000;
// How long a tick holds an enrollment while processing it. Long enough to
// cover a slow step, short enough that a crashed tick frees the row quickly.
const LEASE_MINUTES = 10;

export interface TickSummary {
  due: number;
  completed: number;
  emails_sent: number;
  emails_simulated: number;
  emails_suppressed: number;
  emails_deferred_budget: number;
  emails_deferred_quota: number; // provider refused on volume; parked until the next UTC day
  emails_exempt: number; // activation-critical sends that bypassed a zero budget / tripped breaker
  skipped_locked: number; // due rows another concurrent tick had already claimed
  health_alerts: string[]; // pipeline problems detected this tick (empty = healthy)
  budget_remaining: number | null; // null when the budget is disabled
  breaker_tripped: { bounce_rate: number; complaint_rate: number; sends_24h: number } | null;
  failed: number;
  errors: string[];
  scores_updated: number;
  hot_leads_alerted: number;
  ab_tests_promoted: number;
  booking_reminders_sent: number;
}

// ── Triggers ─────────────────────────────────────────────────────────────────

export interface TriggerEvent {
  type: Exclude<TriggerType, "manual">;
  lead: Lead;
  data?: Record<string, unknown>;
}

function triggerMatches(triggerConfig: Record<string, unknown>, event: TriggerEvent): boolean {
  const cfg = triggerConfig || {};
  if (event.type === "engagement_stage_changed") return !cfg.stage || cfg.stage === event.data?.stage;
  const data = event.data || {};
  switch (event.type) {
    case "tag_added":
      return !cfg.tag || cfg.tag === data.tag;
    case "form_submitted":
      return !cfg.form || cfg.form === data.form;
    case "status_changed":
      return !cfg.status || cfg.status === data.status;
    case "stage_changed":
      return !cfg.stage_id || cfg.stage_id === data.stage_id;
    case "lead_created":
      return !cfg.source || cfg.source === data.source;
    default:
      return false;
  }
}

/** Finds active workflows matching an event and enrolls the lead in each. */
export async function fireTrigger(supabase: AdminClient, event: TriggerEvent): Promise<string[]> {
  const { data: workflows, error } = await supabase
    .from("workflows")
    .select("*")
    .eq("status", "active")
    .eq("trigger_type", event.type);
  if (error || !workflows?.length) return [];

  const enrolled: string[] = [];
  for (const wf of workflows) {
    if (!triggerMatches((wf.trigger_config || {}) as Record<string, unknown>, event)) continue;
    const context = event.type === "engagement_stage_changed" ? { ...event.data } : {};
    const result = await enrollLead(supabase, wf, event.lead, `trigger:${event.type}`, context);
    if (result.enrolled) enrolled.push(wf.id);
  }
  return enrolled;
}

/** Enrolls a lead in a workflow, respecting re-enrollment rules. */
export async function enrollLead(
  supabase: AdminClient,
  workflow: Workflow,
  lead: Lead,
  source: string,
  context: Record<string, unknown> = {}
): Promise<{ enrolled: boolean; reason?: string }> {
  const { data: existing } = await supabase
    .from("workflow_enrollments")
    .select("id, status")
    .eq("workflow_id", workflow.id)
    .eq("lead_id", lead.id);

  if (existing?.some((e) => e.status === "active")) {
    return { enrolled: false, reason: "already active" };
  }
  if (!workflow.allow_reenrollment && existing && existing.length > 0) {
    return { enrolled: false, reason: "re-enrollment not allowed" };
  }

  const { error } = await supabase.from("workflow_enrollments").insert({
    workflow_id: workflow.id,
    lead_id: lead.id,
    status: "active",
    current_step: 0,
    next_run_at: new Date().toISOString(),
    context: { ...context, source } as Json,
  });
  if (error) return { enrolled: false, reason: error.message };

  await supabase
    .from("workflows")
    .update({ enrolled_count: (workflow.enrolled_count || 0) + 1 })
    .eq("id", workflow.id);

  await logActivity(supabase, {
    lead_id: lead.id,
    activity_type: "enrolled",
    title: `Enrolled in workflow: ${workflow.name}`,
    data: { workflow_id: workflow.id, source },
  });

  // A lead in an email sequence belongs in the Nurturing stage of the sales
  // pipeline. Forward-only (never drags a later-stage deal back), and must
  // never fail an enrollment over a pipeline write.
  try {
    await ensureLeadOpportunity(supabase, lead, { stage: "Nurturing", actor: `workflow:${workflow.id}` });
  } catch (e) {
    console.error("enrollLead: ensureLeadOpportunity failed", e);
  }

  return { enrolled: true };
}

// ── Sales pipeline auto-population ────────────────────────────────────────────

/**
 * Auto-population is on by default. Stop it (both the capture→New and
 * enroll→Nurturing hooks) by setting backend_settings.crm_auto_pipeline=false.
 */
async function isAutoPipelineOn(supabase: AdminClient): Promise<boolean> {
  const { data } = await supabase
    .from("backend_settings")
    .select("value")
    .eq("key", "crm_auto_pipeline")
    .maybeSingle();
  return data?.value !== false;
}

export type EnsureOppAction =
  | "created"
  | "advanced"
  | "exists"
  | "no_pipeline"
  | "disabled";

export interface EnsureOppResult {
  action: EnsureOppAction;
  opportunity_id?: string;
  stage?: string;
}

/**
 * Ensures a lead has an open opportunity in the sales pipeline. Idempotent:
 *   - no open deal  → creates one in the target stage (default: first stage / "New")
 *   - open deal in an EARLIER stage than the target → advances it forward
 *   - open deal already at/after the target → left untouched
 *
 * The one place the capture front door and the enrollment engine agree on the
 * pipeline. Real-time, single-lead; bulk backfills use the sync_pipeline tool.
 */
export async function ensureLeadOpportunity(
  supabase: AdminClient,
  lead: Lead,
  opts: { stage?: string; actor?: string } = {}
): Promise<EnsureOppResult> {
  if (!(await isAutoPipelineOn(supabase))) return { action: "disabled" };

  const { data: stages } = await supabase
    .from("pipeline_stages")
    .select("id, name, position, pipeline_id")
    .order("position");
  if (!stages?.length) return { action: "no_pipeline" };

  const wanted = (opts.stage || "").trim().toLowerCase();
  const target = wanted ? stages.find((s) => s.name.toLowerCase() === wanted) : stages[0];
  if (!target) return { action: "no_pipeline" };

  const { data: opps } = await supabase
    .from("opportunities")
    .select("id, stage_id")
    .eq("lead_id", lead.id)
    .eq("status", "open")
    .limit(1);

  if (opps && opps.length > 0) {
    const opp = opps[0];
    const current = stages.find((s) => s.id === opp.stage_id);
    // Forward-only: only advance if the target sits later in the pipeline.
    if (current && target.position > current.position) {
      await supabase
        .from("opportunities")
        .update({ stage_id: target.id, pipeline_id: target.pipeline_id })
        .eq("id", opp.id);
      await logActivity(supabase, {
        lead_id: lead.id,
        activity_type: "stage_changed",
        title: `Moved to stage: ${target.name}`,
        data: { opportunity_id: opp.id, stage_id: target.id, auto: true },
        actor: opts.actor || "system",
      });
      await fireTrigger(supabase, { type: "stage_changed", lead, data: { stage_id: target.id } });
      if (isDealWon({ stageName: target.name })) await onDealWon(moneyDb(supabase), { opportunityId: opp.id, leadId: lead.id, actor: opts.actor || "system" });
      return { action: "advanced", opportunity_id: opp.id, stage: target.name };
    }
    return { action: "exists", opportunity_id: opp.id, stage: current?.name };
  }

  const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ") || lead.email;
  const { data: created, error } = await supabase
    .from("opportunities")
    .insert({ lead_id: lead.id, pipeline_id: target.pipeline_id, stage_id: target.id, name })
    .select("id")
    .single();
  if (error || !created) throw new Error(`ensureLeadOpportunity: ${error?.message}`);

  await logActivity(supabase, {
    lead_id: lead.id,
    activity_type: "stage_changed",
    title: `Opportunity created in stage: ${target.name}`,
    data: { opportunity_id: created.id, stage_id: target.id, auto: true },
    actor: opts.actor || "system",
  });
  await fireTrigger(supabase, { type: "stage_changed", lead, data: { stage_id: target.id } });
  if (isDealWon({ stageName: target.name })) await onDealWon(moneyDb(supabase), { opportunityId: created.id, leadId: lead.id, actor: opts.actor || "system" });
  return { action: "created", opportunity_id: created.id, stage: target.name };
}

// ── Send window ──────────────────────────────────────────────────────────────

function localHourAndDay(date: Date, timeZone: string): { hour: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hour12: false,
    weekday: "short",
  }).formatToParts(date);
  const hourPart = parts.find((p) => p.type === "hour")?.value ?? "0";
  const dayPart = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { hour: Number(hourPart) % 24, day: dayMap[dayPart] ?? 1 };
}

function isWithinWindow(date: Date, window: SendWindow): boolean {
  try {
    const { hour, day } = localHourAndDay(date, window.timezone || "UTC");
    if (window.days?.length && !window.days.includes(day)) return false;
    return hour >= window.start_hour && hour < window.end_hour;
  } catch {
    return true; // bad timezone config should never block sends
  }
}

/** Returns null if sending is allowed now, else the next allowed Date. */
// Resend's daily quota resets at UTC midnight, so the budget day matches.
function nextUtcMidnight(from: Date): Date {
  const next = new Date(from);
  next.setUTCHours(24, 0, 0, 0);
  return next;
}

export function nextAllowedSendTime(window: SendWindow | undefined, from: Date): Date | null {
  if (!window?.enabled) return null;
  if (isWithinWindow(from, window)) return null;
  // Walk forward hour by hour (up to 8 days) to the next open slot
  for (let i = 1; i <= 24 * 8; i++) {
    const candidate = new Date(from.getTime() + i * 3600_000);
    candidate.setMinutes(2, 0, 0);
    if (isWithinWindow(candidate, window)) return candidate;
  }
  return null;
}

// ── Step execution ───────────────────────────────────────────────────────────

interface StepOutcome {
  advance: boolean; // move to next step?
  deferUntil?: Date; // pause until this time (wait steps / send window)
}

async function executeStep(
  supabase: AdminClient,
  step: WorkflowStep,
  lead: Lead,
  workflow: Workflow,
  enrollment: Enrollment,
  stepIndex: number,
  settings: CrmSettings,
  summary: TickSummary
): Promise<StepOutcome> {
  const cfg = step.config || {};

  switch (step.type) {
    case "wait": {
      const ms =
        Number(cfg.days || 0) * 86_400_000 +
        Number(cfg.hours || 0) * 3_600_000 +
        Number(cfg.minutes || 0) * 60_000;
      return { advance: true, deferUntil: new Date(Date.now() + Math.max(ms, 60_000)) };
    }

    case "send_email": {
      // Respect the send window: defer without advancing, retry at window open
      const deferTo = nextAllowedSendTime(settings.send_window, new Date());
      if (deferTo) return { advance: false, deferUntil: deferTo };

      // Reputation guard: daily + per-tick send budget. Defer without
      // advancing (same contract as the send window) — nothing fails,
      // the step just waits for headroom.
      //
      // Activation-critical workflows are exempt: the guard is global, so
      // without this one bad bulk campaign parks onboarding too (see
      // exempt_workflow_ids in settings.ts). Exempt sends still decrement the
      // budget and still respect the send window — they just aren't the ones
      // that get starved when headroom runs out.
      const budget = settings.send_budget;
      const exempt = (budget.exempt_workflow_ids || []).includes(workflow.id);
      if (budget.enabled && !exempt) {
        if (summary.budget_remaining !== null && summary.budget_remaining <= 0) {
          summary.emails_deferred_budget++;
          return { advance: false, deferUntil: nextUtcMidnight(new Date()) };
        }
        if (summary.emails_sent >= budget.per_tick_limit) {
          summary.emails_deferred_budget++;
          return { advance: false, deferUntil: new Date(Date.now() + 15 * 60_000) };
        }
      }
      if (
        exempt &&
        budget.enabled &&
        ((summary.budget_remaining !== null && summary.budget_remaining <= 0) ||
          summary.emails_sent >= budget.per_tick_limit)
      ) {
        summary.emails_exempt++;
      }

      let subject = String(cfg.subject || "");
      let bodyMd = String(cfg.body_md || "");
      let preheader = (cfg.preheader as string) || null;
      let templateId: string | null = null;
      let variant: "a" | "b" | null = null;

      if (cfg.template_id) {
        const { data: tpl } = await supabase
          .from("email_templates")
          .select("*")
          .eq("id", String(cfg.template_id))
          .single();
        if (!tpl) throw new Error(`send_email: template ${cfg.template_id} not found`);
        subject = tpl.subject;
        bodyMd = tpl.body_md;
        preheader = tpl.preheader;
        templateId = tpl.id;
        // Live A/B test: alternate subjects and record the variant
        const subjectB = (tpl as { subject_b?: string | null }).subject_b;
        if (subjectB) {
          variant = Math.random() < 0.5 ? "a" : "b";
          if (variant === "b") subject = subjectB;
        }
      }
      if (!subject || !bodyMd) throw new Error("send_email: missing subject or body");

      const engagementName = (enrollment.context as Record<string, unknown> | null)?.engagement_name;
      const emailLead = typeof engagementName === "string"
        ? { ...lead, custom: { ...((lead.custom || {}) as Record<string, Json>), engagement_name: engagementName } }
        : lead;
      const result = await sendCrmEmail(
        supabase,
        {
          lead: emailLead,
          subject,
          bodyMd,
          preheader,
          templateId,
          variant,
          workflowId: workflow.id,
          enrollmentId: enrollment.id,
          stepNumber: stepIndex + 1,
          actor: "system",
        },
        settings
      );
      if (result.status === "sent") {
        summary.emails_sent++;
        if (summary.budget_remaining !== null) summary.budget_remaining--;
      }
      if (result.status === "simulated") summary.emails_simulated++;
      if (result.status === "suppressed") summary.emails_suppressed++;
      if (result.status === "failed") {
        // Provider refused on volume (quota/rate limit): stop sending for the
        // rest of this tick and park the enrollment until the provider's
        // window resets. No attempt is counted and no retry loop spins —
        // hammering a closed door is what burned Jul 20's 559 junk attempts.
        if (/quota|rate limit|too many requests/i.test(String(result.error || ""))) {
          summary.budget_remaining = 0;
          summary.emails_deferred_quota++;
          return { advance: false, deferUntil: nextUtcMidnight(new Date()) };
        }
        throw new Error(`send_email failed: ${result.error}`);
      }
      return { advance: true };
    }

    case "add_tag": {
      const tag = String(cfg.tag || "").trim();
      if (tag && !(lead.tags || []).includes(tag)) {
        const tags = [...(lead.tags || []), tag];
        await supabase.from("leads").update({ tags }).eq("id", lead.id);
        lead.tags = tags;
        await logActivity(supabase, {
          lead_id: lead.id,
          activity_type: "tag_added",
          title: `Tag added: ${tag}`,
          data: { tag, workflow_id: workflow.id },
        });
        await fireTrigger(supabase, { type: "tag_added", lead, data: { tag } });
      }
      return { advance: true };
    }

    case "remove_tag": {
      const tag = String(cfg.tag || "").trim();
      if (tag && (lead.tags || []).includes(tag)) {
        const tags = (lead.tags || []).filter((t) => t !== tag);
        await supabase.from("leads").update({ tags }).eq("id", lead.id);
        lead.tags = tags;
        await logActivity(supabase, {
          lead_id: lead.id,
          activity_type: "tag_removed",
          title: `Tag removed: ${tag}`,
          data: { tag, workflow_id: workflow.id },
        });
      }
      return { advance: true };
    }

    case "set_status": {
      const status = String(cfg.status || "") as Lead["status"];
      if (status && status !== lead.status) {
        await supabase.from("leads").update({ status }).eq("id", lead.id);
        const old = lead.status;
        lead.status = status;
        await logActivity(supabase, {
          lead_id: lead.id,
          activity_type: "status_changed",
          title: `Status: ${old} → ${status}`,
          data: { from: old, status, workflow_id: workflow.id },
        });
        await fireTrigger(supabase, { type: "status_changed", lead, data: { status } });
      }
      return { advance: true };
    }

    case "move_stage": {
      const stageId = String(cfg.stage_id || "");
      if (!stageId) throw new Error("move_stage: stage_id required");
      const { data: stage } = await supabase
        .from("pipeline_stages")
        .select("id, name, pipeline_id")
        .eq("id", stageId)
        .single();
      if (!stage) throw new Error(`move_stage: stage ${stageId} not found`);

      const { data: opps } = await supabase
        .from("opportunities")
        .select("*")
        .eq("lead_id", lead.id)
        .eq("status", "open")
        .limit(1);

      let opportunityId: string | null = null;
      if (opps && opps.length > 0) {
        await supabase.from("opportunities").update({ stage_id: stage.id, pipeline_id: stage.pipeline_id }).eq("id", opps[0].id);
        opportunityId = opps[0].id;
      } else {
        const { data: created } = await supabase
          .from("opportunities")
          .insert({
            lead_id: lead.id,
            pipeline_id: stage.pipeline_id,
            stage_id: stage.id,
            name: [lead.first_name, lead.last_name].filter(Boolean).join(" ") || lead.email,
          })
          .select("id")
          .single();
        opportunityId = created?.id ?? null;
      }
      await logActivity(supabase, {
        lead_id: lead.id,
        activity_type: "stage_changed",
        title: `Moved to stage: ${stage.name}`,
        data: { stage_id: stage.id, workflow_id: workflow.id },
      });
      await fireTrigger(supabase, { type: "stage_changed", lead, data: { stage_id: stage.id } });
      if (opportunityId && isDealWon({ stageName: stage.name })) await onDealWon(moneyDb(supabase), { opportunityId, leadId: lead.id, actor: `workflow:${workflow.id}` });
      return { advance: true };
    }

    case "update_field": {
      const key = String(cfg.key || "");
      const value = cfg.value;
      if (!key) throw new Error("update_field: key required");
      if (key.startsWith("custom.")) {
        const customKey = key.slice(7);
        const custom = { ...((lead.custom as Record<string, unknown>) || {}), [customKey]: value };
        await supabase.from("leads").update({ custom: custom as Json }).eq("id", lead.id);
        lead.custom = custom as Json;
      } else {
        const allowed = ["first_name", "last_name", "phone", "company", "score", "timezone"];
        if (!allowed.includes(key)) throw new Error(`update_field: field ${key} not allowed`);
        await supabase.from("leads").update({ [key]: value }).eq("id", lead.id);
        (lead as unknown as Record<string, unknown>)[key] = value;
      }
      await logActivity(supabase, {
        lead_id: lead.id,
        activity_type: "field_updated",
        title: `Field updated: ${key}`,
        data: { key, value, workflow_id: workflow.id } as Record<string, unknown>,
      });
      return { advance: true };
    }

    case "webhook": {
      const url = String(cfg.url || "");
      if (!/^https?:\/\//.test(url)) throw new Error("webhook: valid url required");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      let ok = false;
      let statusCode = 0;
      try {
        const payloadTemplate = cfg.payload && typeof cfg.payload === "object" ? cfg.payload : {};
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "workflow_webhook",
            workflow_id: workflow.id,
            workflow_name: workflow.name,
            step_id: step.id,
            lead: cfg.include_lead === false ? { id: lead.id } : {
              id: lead.id,
              email: lead.email,
              first_name: lead.first_name,
              last_name: lead.last_name,
              phone: lead.phone,
              company: lead.company,
              tags: lead.tags,
              status: lead.status,
              custom: lead.custom,
            },
            ...payloadTemplate,
          }),
          signal: controller.signal,
        });
        ok = res.ok;
        statusCode = res.status;
      } finally {
        clearTimeout(timer);
      }
      await logActivity(supabase, {
        lead_id: lead.id,
        activity_type: "webhook",
        title: `Webhook ${ok ? "delivered" : `failed (${statusCode})`}: ${url}`,
        data: { url, ok, status: statusCode, workflow_id: workflow.id },
      });
      if (!ok) throw new Error(`webhook: ${url} responded ${statusCode}`);
      return { advance: true };
    }

    case "create_task": {
      const title = renderMergeTags(String(cfg.title || "Follow up"), lead);
      const dueInDays = Number(cfg.due_in_days || 0);
      await supabase.from("crm_tasks").insert({
        lead_id: lead.id,
        title,
        description: cfg.description ? renderMergeTags(String(cfg.description), lead) : null,
        due_at: dueInDays > 0 ? new Date(Date.now() + dueInDays * 86_400_000).toISOString() : null,
        created_by: `workflow:${workflow.id}`,
      });
      await logActivity(supabase, {
        lead_id: lead.id,
        activity_type: "task_created",
        title: `Task created: ${title}`,
        data: { workflow_id: workflow.id },
      });
      return { advance: true };
    }

    default:
      throw new Error(`Unknown step type: ${step.type}`);
  }
}

// ── Enrollment processing ────────────────────────────────────────────────────

async function processEnrollment(
  supabase: AdminClient,
  enrollment: Enrollment & { workflows: Workflow | null; leads: Lead | null },
  settings: CrmSettings,
  summary: TickSummary
): Promise<void> {
  const workflow = enrollment.workflows;
  const lead = enrollment.leads;

  if (!workflow || !lead) {
    await supabase
      .from("workflow_enrollments")
      .update({ status: "failed", last_error: "workflow or lead missing" })
      .eq("id", enrollment.id);
    return;
  }

  // Paused/archived workflows freeze their enrollments (checked on fetch too)
  if (workflow.status !== "active") return;

  const steps = parseSteps(workflow.steps);
  let stepIndex = enrollment.current_step;
  let executed = 0;

  try {
    while (stepIndex < steps.length && executed < MAX_STEPS_PER_TICK) {
      const outcome = await executeStep(
        supabase,
        steps[stepIndex],
        lead,
        workflow,
        enrollment,
        stepIndex,
        settings,
        summary
      );
      executed++;

      if (outcome.advance) stepIndex++;

      if (outcome.deferUntil) {
        await supabase
          .from("workflow_enrollments")
          .update({
            current_step: stepIndex,
            next_run_at: outcome.deferUntil.toISOString(),
            last_error: null,
            context: { ...((enrollment.context as Record<string, unknown>) || {}), attempts: 0 } as Json,
          })
          .eq("id", enrollment.id);
        return;
      }
    }

    if (stepIndex >= steps.length) {
      await supabase
        .from("workflow_enrollments")
        .update({
          status: "completed",
          current_step: stepIndex,
          completed_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", enrollment.id);
      await supabase
        .from("workflows")
        .update({ completed_count: (workflow.completed_count || 0) + 1 })
        .eq("id", workflow.id);
      await logActivity(supabase, {
        lead_id: lead.id,
        activity_type: "workflow_completed",
        title: `Completed workflow: ${workflow.name}`,
        data: { workflow_id: workflow.id },
      });
      summary.completed++;
    } else {
      // Hit the per-tick step budget; continue next tick
      await supabase
        .from("workflow_enrollments")
        .update({ current_step: stepIndex, next_run_at: new Date().toISOString() })
        .eq("id", enrollment.id);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown step error";
    const attempts = Number((enrollment.context as Record<string, unknown>)?.attempts || 0) + 1;
    summary.errors.push(`${workflow.name} → ${lead.email}: ${message}`);

    if (attempts >= MAX_ATTEMPTS) {
      summary.failed++;
      await supabase
        .from("workflow_enrollments")
        .update({ status: "failed", current_step: stepIndex, last_error: message })
        .eq("id", enrollment.id);
      await logActivity(supabase, {
        lead_id: lead.id,
        activity_type: "workflow_failed",
        title: `Workflow failed after ${attempts} attempts: ${workflow.name}`,
        body: message,
        data: { workflow_id: workflow.id },
      });
    } else {
      await supabase
        .from("workflow_enrollments")
        .update({
          current_step: stepIndex,
          next_run_at: new Date(Date.now() + RETRY_DELAY_MS).toISOString(),
          last_error: message,
          context: { ...((enrollment.context as Record<string, unknown>) || {}), attempts } as Json,
        })
        .eq("id", enrollment.id);
    }
  }
}

/**
 * The engine tick: processes all due enrollments. Called by the scheduled
 * GitHub Action (every ~10 min), the admin "Run engine" button, or any agent.
 * Idempotent and safe to call as often as you like.
 */
export async function runEngineTick(supabase: AdminClient, limit = 100): Promise<TickSummary> {
  const summary: TickSummary = {
    due: 0,
    completed: 0,
    emails_sent: 0,
    emails_simulated: 0,
    emails_suppressed: 0,
    emails_deferred_budget: 0,
    emails_deferred_quota: 0,
    emails_exempt: 0,
    skipped_locked: 0,
    health_alerts: [],
    budget_remaining: null,
    breaker_tripped: null,
    failed: 0,
    errors: [],
    scores_updated: 0,
    hot_leads_alerted: 0,
    ab_tests_promoted: 0,
    booking_reminders_sent: 0,
  };

  const settings = await getCrmSettings(supabase);

  // Compute today's remaining send budget from what actually reached the
  // provider (simulated/suppressed/failed sends never consumed reputation).
  if (settings.send_budget.enabled) {
    const startOfUtcDay = new Date().toISOString().slice(0, 10) + "T00:00:00Z";
    const { count, error: budgetError } = await supabase
      .from("email_sends")
      .select("id", { count: "exact", head: true })
      .gte("created_at", startOfUtcDay)
      .not("status", "in", "(failed,simulated,suppressed)");
    if (budgetError || count === null) {
      // Can't verify usage — allow at most one tick's worth rather than
      // stalling email entirely or running unmetered.
      summary.errors.push(`send budget count: ${budgetError?.message || "no count returned"}`);
      summary.budget_remaining = settings.send_budget.per_tick_limit;
    } else {
      summary.budget_remaining = Math.max(0, settings.send_budget.daily_limit - count);
    }
  }

  // Circuit breaker (reactivation plan): pause all sends while the rolling-24h
  // bounce or complaint rate is over threshold. Re-evaluated every tick, so it
  // auto-resumes once the bad batch ages out of the window.
  if (settings.send_budget.enabled) {
    const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
    const [sends24, bounces24, complaints24] = await Promise.all([
      supabase
        .from("email_sends")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since)
        .not("status", "in", "(failed,simulated,suppressed)"),
      supabase
        .from("email_events")
        .select("id", { count: "exact", head: true })
        .eq("event_type", "bounced")
        .gte("created_at", since),
      supabase
        .from("email_events")
        .select("id", { count: "exact", head: true })
        .eq("event_type", "complained")
        .gte("created_at", since),
    ]);
    const sends = sends24.count ?? 0;
    if (sends >= settings.send_budget.breaker_min_sends) {
      const bounceRate = (bounces24.count ?? 0) / sends;
      const complaintRate = (complaints24.count ?? 0) / sends;
      if (
        bounceRate > settings.send_budget.max_bounce_rate ||
        complaintRate > settings.send_budget.max_complaint_rate
      ) {
        summary.breaker_tripped = {
          bounce_rate: bounceRate,
          complaint_rate: complaintRate,
          sends_24h: sends,
        };
        summary.budget_remaining = 0;
        summary.errors.push(
          `circuit breaker: last 24h bounce ${(bounceRate * 100).toFixed(1)}% / complaint ${(complaintRate * 100).toFixed(2)}% over ${sends} sends — all sends paused this tick`
        );
      }
    }
  }

  const { data: due, error } = await supabase
    .from("workflow_enrollments")
    .select("*, workflows(*), leads(*)")
    .eq("status", "active")
    .lte("next_run_at", new Date().toISOString())
    .order("next_run_at", { ascending: true })
    .limit(limit);

  if (error) {
    summary.errors.push(`fetch due enrollments: ${error.message}`);
    return summary;
  }

  summary.due = due?.length || 0;

  for (const enrollment of due || []) {
    // Claim the row before touching it. Two ticks running at once both SELECT
    // the same due enrollments, and without this both send — that is exactly
    // what happened on 2026-07-27 when two manual dispatches landed 22s apart
    // and two members received the same email twice.
    //
    // The compare-and-swap on next_run_at is the lock: PostgreSQL takes a row
    // lock for the UPDATE and re-checks the value we read, so only one tick can
    // win. The loser sees 0 rows and skips. If a tick dies mid-enrollment the
    // lease simply expires and the next tick picks it up.
    const lease = new Date(Date.now() + LEASE_MINUTES * 60_000).toISOString();
    const { data: claimed } = await supabase
      .from("workflow_enrollments")
      .update({ next_run_at: lease })
      .eq("id", enrollment.id)
      .eq("next_run_at", enrollment.next_run_at)
      .eq("status", "active")
      .select("id");
    if (!claimed?.length) {
      summary.skipped_locked++;
      continue;
    }

    await processEnrollment(
      supabase,
      enrollment as unknown as Enrollment & { workflows: Workflow | null; leads: Lead | null },
      settings,
      summary
    );
  }

  // Keep lead scores fresh on the same heartbeat — never let a scoring
  // hiccup fail the tick itself.
  try {
    const scores = await recomputeLeadScores(supabase);
    summary.scores_updated = scores.updated;
    if (scores.hot_crossings.length > 0) {
      summary.hot_leads_alerted = await alertHotLeads(supabase, scores.hot_crossings);
    }
  } catch (e) {
    summary.errors.push(`recompute scores: ${e instanceof Error ? e.message : "unknown error"}`);
  }

  // Settle any A/B subject tests with enough data (no-op until migration 018;
  // promotions are recorded in agent_logs)
  try {
    const ab = await promoteSubjectTests(supabase);
    summary.ab_tests_promoted = ab.promoted.length;
  } catch {
    // subject_b column not there yet — testing simply isn't enabled
  }

  // Booking reminders (Cal.com): time-critical, so they bypass the send
  // window — and like scoring, a hiccup must never fail the tick.
  try {
    const reminders = await sendBookingReminders(supabase, settings);
    summary.booking_reminders_sent = reminders.sent + reminders.simulated;
    summary.errors.push(...reminders.errors.map((e) => `booking reminder: ${e}`));
  } catch (e) {
    summary.errors.push(`booking reminders: ${e instanceof Error ? e.message : "unknown error"}`);
  }

  // Pipeline health: the last line of defence. A tripped breaker parks every
  // enrollment while clearing last_error, so without this nothing anywhere
  // reports a fault — that is how a five-day send outage went unnoticed.
  // Never let a health-check hiccup fail the tick itself.
  try {
    const health = await runHealthChecks(supabase, settings, summary.breaker_tripped);
    summary.health_alerts = health.alerts.map((a) => a.key);
  } catch (e) {
    summary.errors.push(`health checks: ${e instanceof Error ? e.message : "unknown error"}`);
  }

  if (summary.due > 0) {
    await supabase.from("agent_logs").insert({
      agent: "email_agent",
      action: "crm_tick",
      description: `Processed ${summary.due} enrollments`,
      status: summary.errors.length ? "completed" : "completed",
      output_data: summary as unknown as Json,
    });
  }

  return summary;
}
