/**
 * Home events — the pure half: the action vocabulary, shape validation, the
 * receipt rule, actors, the event builders each emit point calls, the feed
 * cursor and the redaction pass (see EVENTS.md).
 *
 * No framework imports, so `node --test` can load it and a poller can reuse
 * it. The database half (insert, read, count, scrub) is ./record.ts and
 * ./feed.ts.
 *
 * The receipt rule: a home event says that something happened and points at
 * it; it never copies personal data. Payload and evidence carry ids, slugs,
 * numbers, booleans and fixed enums only, never names, emails, subjects,
 * titles or free text. An agent that needs the lead reads it with leads:read.
 */

import type { AuthResult } from "../api/auth.ts";

/**
 * Every action the Home records, noun.verb with the noun first so a prefix
 * filter (`lead.`) picks a whole family. An action outside this list is
 * refused; add it here (and to EVENTS.md) first.
 */
export const HOME_EVENT_ACTIONS = [
  "payment.processed",
  "lead.captured",
  "lead.updated",
  "deal.moved",
  "deal.won",
  "deal.lost",
  "deal.reopened",
  "email.sent",
  "email.simulated",
  "article.published",
  "approval.proposed",
  "approval.granted",
  "approval.rejected",
  "approval.executed",
  "approval.failed",
  "key.minted",
  "key.revoked",
] as const;

export type HomeEventAction = (typeof HOME_EVENT_ACTIONS)[number];

export const HOME_EVENT_ACTOR_TYPES = ["human", "agent", "system", "webhook"] as const;

export type HomeEventActorType = (typeof HOME_EVENT_ACTOR_TYPES)[number];

export interface HomeEventActor {
  actor_type: HomeEventActorType;
  actor: string;
}

export interface HomeEventInput extends HomeEventActor {
  action: HomeEventAction;
  subject_type?: string | null;
  subject_id?: string | null;
  lead_id?: string | null;
  payload?: Record<string, unknown>;
  evidence?: Record<string, unknown>;
}

/** The row handed to the insert: defaults filled, nothing undefined. */
export interface HomeEventRecord extends HomeEventActor {
  action: HomeEventAction;
  subject_type: string | null;
  subject_id: string | null;
  lead_id: string | null;
  payload: Record<string, unknown>;
  evidence: Record<string, unknown>;
}

export type ValidatedHomeEvent = { ok: true; event: HomeEventRecord } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT = 200;
/** A receipt, not a document: payload and evidence stay small. */
export const MAX_JSON_BYTES = 4_096;

export function isHomeEventAction(value: unknown): value is HomeEventAction {
  return typeof value === "string" && (HOME_EVENT_ACTIONS as readonly string[]).includes(value);
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ── The receipt rule ────────────────────────────────────────────────────────

/** An opaque id: a uuid, a Stripe or Resend id, a Skool user id. No spaces, no @. */
const ID_RE = /^[A-Za-z0-9_-]{1,255}$/;
/** An article slug. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,199}$/;
/** A code constant such as an alert kind: snake_case, set in code, never typed by a person. */
const CODE_CONSTANT_RE = /^[a-z][a-z_]{1,39}$/;
/** An agent key name (validateKeyName in src/lib/api/agent-key-scopes.ts). */
const KEY_NAME_RE = /^[a-z][a-z0-9_-]{1,39}$/;

/** String fields with a fixed set of values. */
export const RECEIPT_ENUMS: Record<string, readonly string[]> = {
  status: ["open", "won", "lost"],
  type: ["email", "publish", "workflow", "other"],
  outcome: [
    "sent", "simulated", "suppressed", "published", "scheduled", "activated",
    "acknowledged", "confirmed", "already_done", "failed", "done",
  ],
  via: ["pipeline", "operator", "skool", "event_booking", "approval"],
};

/** String fields whose value is a code constant (see CODE_CONSTANT_RE). */
const CODE_CONSTANT_FIELDS = new Set(["kind"]);

function isIdField(key: string): boolean {
  return key === "id" || key.endsWith("_id");
}

/** Why one payload or evidence field breaks the receipt rule, or null when it is fine. */
function receiptFieldProblem(key: string, value: unknown): string | null {
  if (value === null || typeof value === "boolean") return null;
  if (typeof value === "number") return Number.isFinite(value) ? null : "not a finite number";
  if (typeof value !== "string") return "not a scalar";
  if (value.includes("@")) return "contains @";
  if (key in RECEIPT_ENUMS) return RECEIPT_ENUMS[key].includes(value) ? null : `not one of ${key}'s values`;
  if (CODE_CONSTANT_FIELDS.has(key)) return CODE_CONSTANT_RE.test(value) ? null : "not a code constant";
  if (key === "slug") return SLUG_RE.test(value) ? null : "not a slug";
  if (key === "key_name") return KEY_NAME_RE.test(value) ? null : "not a key name";
  if (isIdField(key)) return ID_RE.test(value) ? null : "not an id";
  return "free text";
}

/**
 * Every field of `fields` that breaks the receipt rule, as "key: reason".
 * Empty means the object is safe to write. Tests run every builder's output
 * through this.
 */
export function receiptProblems(fields: Record<string, unknown>): string[] {
  const problems: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    const problem = receiptFieldProblem(key, value);
    if (problem) problems.push(`${key}: ${problem}`);
  }
  return problems;
}

/** Keeps only the fields that pass the receipt rule. The safety net under the builders. */
export function receiptSafe(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (!receiptFieldProblem(key, value)) out[key] = value;
  }
  return out;
}

function optionalId(value: unknown, field: string): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  if (typeof value !== "string" || !ID_RE.test(value)) return { ok: false, error: `${field} must be an id` };
  return { ok: true, value };
}

function jsonField(value: unknown, field: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, value: {} };
  if (!isPlainObject(value)) return { ok: false, error: `${field} must be an object` };
  const safe = receiptSafe(redactSecrets(value) as Record<string, unknown>);
  if (JSON.stringify(safe).length > MAX_JSON_BYTES) return { ok: false, error: `${field} is larger than ${MAX_JSON_BYTES} bytes` };
  return { ok: true, value: safe };
}

/**
 * Checks an event before it is written. Payload and evidence pass through
 * redactSecrets and then receiptSafe, so a stray token or a lead's email
 * never lands in the stream even when a caller forgets the rule.
 */
export function validateHomeEvent(input: unknown): ValidatedHomeEvent {
  if (!isPlainObject(input)) return { ok: false, error: "event must be an object" };

  if (!(HOME_EVENT_ACTOR_TYPES as readonly string[]).includes(input.actor_type as string)) {
    return { ok: false, error: `actor_type must be one of ${HOME_EVENT_ACTOR_TYPES.join(", ")}` };
  }
  if (typeof input.actor !== "string" || !input.actor.trim()) return { ok: false, error: "actor is required" };
  if (input.actor.length > MAX_TEXT) return { ok: false, error: `actor is longer than ${MAX_TEXT} characters` };
  if (input.actor.includes("@")) return { ok: false, error: "actor must be an id or a name, never an email" };
  if (!isHomeEventAction(input.action)) {
    return { ok: false, error: `unknown action "${String(input.action)}"; known: ${HOME_EVENT_ACTIONS.join(", ")}` };
  }

  const subjectType = input.subject_type ?? null;
  if (subjectType !== null && (typeof subjectType !== "string" || !CODE_CONSTANT_RE.test(subjectType))) {
    return { ok: false, error: "subject_type must be a snake_case name such as lead or agent_key" };
  }
  const subjectId = optionalId(input.subject_id, "subject_id");
  if (!subjectId.ok) return subjectId;

  const leadId = input.lead_id ?? null;
  if (leadId !== null && !isUuid(leadId)) return { ok: false, error: "lead_id must be a uuid" };

  const payload = jsonField(input.payload, "payload");
  if (!payload.ok) return payload;
  const evidence = jsonField(input.evidence, "evidence");
  if (!evidence.ok) return evidence;

  return {
    ok: true,
    event: {
      actor_type: input.actor_type as HomeEventActorType,
      actor: input.actor.trim(),
      action: input.action,
      subject_type: subjectType,
      subject_id: subjectId.value,
      lead_id: leadId,
      payload: payload.value,
      evidence: evidence.value,
    },
  };
}

// ── Actors ──────────────────────────────────────────────────────────────────

/**
 * Who a request is. A session is the human (their user id); every API key is
 * an agent named by its key: `master`, an env key (`hermes`, `content_agent`)
 * or a minted key's name (`simon`).
 */
export function actorFromAuth(auth: AuthResult): HomeEventActor {
  if (!auth.authenticated) return { actor_type: "system", actor: "anonymous" };
  if (auth.mode === "session") return { actor_type: "human", actor: auth.userId };
  return { actor_type: "agent", actor: auth.agent };
}

/**
 * The owner deciding over Telegram. The Operator only calls decide on the
 * owner's exact confirmation phrase, so the decision is the human's.
 */
export const TELEGRAM_OWNER: HomeEventActor = { actor_type: "human", actor: "telegram" };

/**
 * Who decided an approval through the Operator's tools. Only the Telegram
 * channel is the owner (Hermes relays the owner's exact confirmation phrase);
 * Operator chat, batch runs and other MCP callers are the agent itself.
 */
export function deciderForChannel(channel: string | undefined, agent?: string): HomeEventActor {
  if (channel === "telegram") return TELEGRAM_OWNER;
  return { actor_type: "agent", actor: agent && KEY_NAME_RE.test(agent) ? agent : "operator" };
}

/** Sources that reach the Home by webhook and stamp themselves as the actor. */
const WEBHOOK_SOURCES = new Set(["calcom", "stripe", "resend", "skool", "zapier"]);

/**
 * Maps the free-text actor the CRM already writes on lead_activities
 * ("system", "human", "agent:operator", "user:<id>", "capture:funnel-secret",
 * "calcom", "workflow:<id>") to an event actor, so existing write paths can
 * emit without changing what they log.
 */
export function actorFromLabel(label: string | null | undefined): HomeEventActor {
  const raw = (label || "").trim();
  if (!raw || raw === "system") return { actor_type: "system", actor: "system" };
  if (raw === "cron") return { actor_type: "system", actor: "cron" };

  const colon = raw.indexOf(":");
  const head = colon === -1 ? raw : raw.slice(0, colon);
  const tail = colon === -1 ? "" : raw.slice(colon + 1);

  if (head === "agent" && tail) return { actor_type: "agent", actor: tail };
  if (raw === "operator" || raw === "master") return { actor_type: "agent", actor: raw };
  if (head === "user" && tail) return { actor_type: "human", actor: tail };
  if (raw === "human" || raw === "lead") return { actor_type: "human", actor: raw };
  if (head === "webhook" && tail) return { actor_type: "webhook", actor: tail };
  // Website forms and funnels post to /api/crm/capture.
  if (head === "capture") return { actor_type: "webhook", actor: raw };
  if (WEBHOOK_SOURCES.has(head)) return { actor_type: "webhook", actor: raw };
  return { actor_type: "system", actor: raw };
}

// ── Provenance ──────────────────────────────────────────────────────────────

/**
 * Payload keys that prove where an action came from. Copied into evidence
 * when present. The approval.proposed trigger in the migration copies the
 * same list (a test holds them together); change both together.
 */
export const PROVENANCE_KEYS = [
  "buzz_event_id",
  "buzz_message_id",
  "email_id",
  "webhook_id",
  "request_id",
  "source_event_id",
  "skool_user_id",
  "stripe_session_id",
] as const;

export function provenanceFromPayload(payload: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isPlainObject(payload)) return out;
  for (const key of PROVENANCE_KEYS) {
    const value = payload[key];
    const text = typeof value === "number" && Number.isFinite(value) ? String(value) : value;
    if (typeof text === "string" && ID_RE.test(text)) out[key] = text;
  }
  return out;
}

function idOrNull(value: unknown): string | null {
  return typeof value === "string" && ID_RE.test(value) ? value : null;
}

// ── Builders: one per emit point ────────────────────────────────────────────

/** lead.captured / lead.updated, from upsertLead. Never the email, name, source text or tags. */
export function leadUpsertEvent(
  actor: HomeEventActor,
  leadId: string,
  created: boolean,
  addedTagCount: number
): HomeEventInput {
  return {
    ...actor,
    action: created ? "lead.captured" : "lead.updated",
    subject_type: "lead",
    subject_id: leadId,
    lead_id: isUuid(leadId) ? leadId : null,
    payload: { added_tag_count: addedTagCount },
  };
}

/**
 * Which lead_activities rows are also home events. Stage moves and email
 * sends each happen in many places but are all logged through logActivity,
 * so that one choke point emits them. Everything else returns null.
 */
export function homeActionForActivity(
  activityType: string,
  data: Record<string, unknown> | undefined
): HomeEventAction | null {
  if (activityType === "email_sent") return data?.simulated ? "email.simulated" : "email.sent";
  if (activityType === "stage_changed") {
    if (data?.status === "won") return "deal.won";
    if (data?.status === "lost") return "deal.lost";
    if (data?.status === "open") return "deal.reopened";
    return "deal.moved";
  }
  return null;
}

/**
 * The event a lead_activities row stands for, or null when it is not one.
 * Picks ids and flags out of `data` by name; the title and any text in data
 * (a lost reason, a preview address) stay on the lead timeline.
 */
export function eventFromActivity(input: {
  lead_id: string;
  activity_type: string;
  title: string;
  data?: Record<string, unknown>;
  actor?: string;
}): HomeEventInput | null {
  const action = homeActionForActivity(input.activity_type, input.data);
  if (!action) return null;
  const data = input.data || {};
  const lead = isUuid(input.lead_id) ? input.lead_id : null;
  const actor = actorFromLabel(input.actor);

  if (action === "email.sent" || action === "email.simulated") {
    return {
      ...actor,
      action,
      subject_type: "email",
      subject_id: idOrNull(data.send_id),
      lead_id: lead,
      payload: receiptSafe({ workflow_id: idOrNull(data.workflow_id) ?? undefined }),
      evidence: receiptSafe({
        ...provenanceFromPayload(data),
        email_id: idOrNull(data.resend_id) ?? undefined,
        send_id: idOrNull(data.send_id) ?? undefined,
        agent_action_id: idOrNull(data.agent_action_id) ?? undefined,
      }),
    };
  }

  const status = data.status === "won" || data.status === "lost" || data.status === "open" ? data.status : undefined;
  return {
    ...actor,
    action,
    subject_type: "opportunity",
    subject_id: idOrNull(data.opportunity_id),
    lead_id: lead,
    payload: receiptSafe({
      opportunity_id: idOrNull(data.opportunity_id) ?? undefined,
      stage_id: idOrNull(data.stage_id) ?? undefined,
      workflow_id: idOrNull(data.workflow_id) ?? undefined,
      status,
      auto: typeof data.auto === "boolean" ? data.auto : undefined,
    }),
  };
}

/** deal.won written outside logActivity: a Skool join or a paid event booking. */
export function dealWonEvent(
  actor: HomeEventActor,
  input: {
    opportunityId: string;
    leadId: string;
    via: "skool" | "event_booking";
    created: boolean;
    valueCents?: number | null;
    evidence?: Record<string, unknown>;
  }
): HomeEventInput {
  return {
    ...actor,
    action: "deal.won",
    subject_type: "opportunity",
    subject_id: input.opportunityId,
    lead_id: isUuid(input.leadId) ? input.leadId : null,
    payload: receiptSafe({
      opportunity_id: input.opportunityId,
      status: "won",
      via: input.via,
      created: input.created,
      value_cents: typeof input.valueCents === "number" ? input.valueCents : undefined,
    }),
    evidence: provenanceFromPayload(input.evidence),
  };
}

/** article.published. The slug is public (it is the URL); the title is not copied. */
export function articlePublishedEvent(
  actor: HomeEventActor,
  article: { id: string; slug?: string | null; calendarEntryId?: string | null; agentActionId?: string | null }
): HomeEventInput {
  return {
    ...actor,
    action: "article.published",
    subject_type: "article",
    subject_id: article.id,
    payload: receiptSafe({
      slug: article.slug && SLUG_RE.test(article.slug) ? article.slug : undefined,
      calendar_entry_id: idOrNull(article.calendarEntryId) ?? undefined,
    }),
    evidence: receiptSafe({ agent_action_id: idOrNull(article.agentActionId) ?? undefined }),
  };
}

/** key.minted / key.revoked. The key's name only: never the key, its prefix or its scopes. */
export function agentKeyEvent(
  actor: HomeEventActor,
  action: "key.minted" | "key.revoked",
  key: { id: string; name: string }
): HomeEventInput {
  return {
    ...actor,
    action,
    subject_type: "agent_key",
    subject_id: key.id,
    payload: receiptSafe({ key_name: key.name }),
  };
}

// ── Approvals ───────────────────────────────────────────────────────────────

/**
 * What execution of an approved action came to, as one enum. The result
 * itself (subjects, addresses, errors) stays on the agent_actions row.
 */
export function approvalOutcome(result: unknown): string {
  if (!isPlainObject(result)) return "done";
  if (typeof result.error === "string" && Object.keys(result).length === 1) return "failed";
  if (result.already !== undefined || result.already_active === true) return "already_done";
  const status = result.status;
  if (status === "sent" || status === "simulated" || status === "suppressed" || status === "failed") return status;
  if (result.published === true || (typeof result.published === "number" && result.published > 0)) return "published";
  if (result.scheduled === true) return "scheduled";
  if (result.activated === true) return "activated";
  if (result.acknowledged === true) return "acknowledged";
  if (result.ok === true) return "confirmed";
  return "done";
}

/**
 * The receipt for a decision on an agent_actions row: granted, rejected,
 * executed or failed. Provenance in the proposal's payload is copied into
 * evidence. The proposal's title and payload text are not.
 */
export function approvalEvent(
  action: { id: string; type: string; title?: string; payload: unknown; run_id?: string | null },
  homeAction: Extract<HomeEventAction, `approval.${string}`>,
  decidedBy: HomeEventActor,
  result?: unknown
): HomeEventInput {
  const payload = isPlainObject(action.payload) ? action.payload : {};
  const kind = payload.kind ?? payload.alert_kind;
  return {
    ...decidedBy,
    action: homeAction,
    subject_type: "approval",
    subject_id: action.id,
    lead_id: isUuid(payload.lead_id) ? payload.lead_id : null,
    payload: receiptSafe({
      type: action.type,
      kind: typeof kind === "string" ? kind : undefined,
      run_id: idOrNull(action.run_id) ?? undefined,
      outcome: result === undefined ? undefined : approvalOutcome(result),
    }),
    evidence: { agent_action_id: action.id, ...provenanceFromPayload(payload) },
  };
}

// ── Cursor ──────────────────────────────────────────────────────────────────

const CURSOR_PREFIX = "he1:";

/** Unpadded base64url. Exported for tests and pollers that build fixtures. */
export function toBase64Url(text: string): string {
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): string | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  try {
    return atob(padded);
  } catch {
    return null;
  }
}

/** An opaque cursor for "everything after seq". Pollers store it, never parse it. */
export function encodeCursor(seq: number): string {
  if (!Number.isSafeInteger(seq) || seq < 0) throw new RangeError("seq must be a non-negative safe integer");
  return toBase64Url(`${CURSOR_PREFIX}${seq}`);
}

/** The seq inside a cursor, or null when it is not one of ours. */
export function decodeCursor(cursor: string | null | undefined): number | null {
  if (!cursor) return null;
  const text = fromBase64Url(cursor.trim());
  if (!text || !text.startsWith(CURSOR_PREFIX)) return null;
  const digits = text.slice(CURSOR_PREFIX.length);
  if (!/^\d{1,16}$/.test(digits)) return null;
  const seq = Number(digits);
  return Number.isSafeInteger(seq) ? seq : null;
}

// ── Feed query ──────────────────────────────────────────────────────────────

export const FEED_DEFAULT_LIMIT = 100;
export const FEED_MAX_LIMIT = 500;

/**
 * How old an event must be before the feed serves it. seq is assigned when a
 * row is inserted but becomes visible when its transaction commits, so a
 * lower seq can appear after a higher one. Holding back the newest few
 * seconds lets those commits land before a poller's cursor steps past them.
 */
export const FEED_SETTLE_MS = 5_000;

export interface FeedQuery {
  /** Return rows with seq greater than this; 0 is from the beginning. */
  afterSeq: number;
  limit: number;
  /** An action prefix such as `lead.`, or an exact action such as `approval.granted`. */
  actionPrefix: string | null;
  leadId: string | null;
}

export type ParsedFeedQuery = { ok: true; query: FeedQuery } | { ok: false; error: string };

/** Reads ?since=&limit=&action=&lead_id= into a FeedQuery, refusing anything malformed. */
export function parseFeedQuery(params: { get(name: string): string | null }): ParsedFeedQuery {
  const since = params.get("since");
  let afterSeq = 0;
  if (since) {
    const decoded = decodeCursor(since);
    if (decoded === null) return { ok: false, error: "since is not a cursor this feed issued" };
    afterSeq = decoded;
  }

  const limitRaw = params.get("limit");
  let limit = FEED_DEFAULT_LIMIT;
  if (limitRaw !== null && limitRaw !== "") {
    if (!/^\d+$/.test(limitRaw)) return { ok: false, error: `limit must be 1..${FEED_MAX_LIMIT}` };
    limit = Number(limitRaw);
    if (limit < 1 || limit > FEED_MAX_LIMIT) return { ok: false, error: `limit must be 1..${FEED_MAX_LIMIT}` };
  }

  const action = params.get("action")?.trim() || null;
  if (action !== null && !/^[a-z_]{1,40}(\.[a-z_]{0,40})?$/.test(action)) {
    return { ok: false, error: "action must be a prefix such as lead. or approval.granted" };
  }

  const leadId = params.get("lead_id")?.trim() || null;
  if (leadId !== null && !isUuid(leadId)) return { ok: false, error: "lead_id must be a uuid" };

  return { ok: true, query: { afterSeq, limit, actionPrefix: action, leadId } };
}

// ── Redaction ───────────────────────────────────────────────────────────────

/** Keys that never leave the Home, whatever a payload carries. */
export const SECRET_KEY_RE = /secret|token|cookie|password|key$/i;

/** Values that look like a credential whatever their key: a minted key, a bearer header, a JWT. */
const SECRET_VALUE_RE = /^(bbk_[a-z][a-z0-9_-]*_[0-9a-f]{32}|Bearer\s+\S+|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;

export const REDACTED = "[redacted]";

/**
 * Drops every key matching SECRET_KEY_RE, at any depth. A safety net: emit
 * points write clean payloads, and this runs on the way in and on the way out.
 * Provenance ids (`buzz_event_id`, `email_id`) do not match and survive.
 * A string value shaped like a credential is replaced with "[redacted]".
 */
export function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > 12) return null;
  if (typeof value === "string") return SECRET_VALUE_RE.test(value.trim()) ? REDACTED : value;
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, depth + 1));
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY_RE.test(key)) continue;
    out[key] = redactSecrets(item, depth + 1);
  }
  return out;
}
