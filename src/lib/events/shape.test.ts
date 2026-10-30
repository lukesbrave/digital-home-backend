import assert from "node:assert/strict";
import test from "node:test";
import type { AuthResult } from "../api/auth.ts";
import {
  actorFromAuth,
  actorFromLabel,
  agentKeyEvent,
  approvalEvent,
  approvalOutcome,
  articlePublishedEvent,
  dealWonEvent,
  deciderForChannel,
  decodeCursor,
  encodeCursor,
  eventFromActivity,
  FEED_MAX_LIMIT,
  HOME_EVENT_ACTIONS,
  isHomeEventAction,
  leadUpsertEvent,
  parseFeedQuery,
  provenanceFromPayload,
  receiptProblems,
  receiptSafe,
  REDACTED,
  redactSecrets,
  TELEGRAM_OWNER,
  toBase64Url,
  validateHomeEvent,
  type HomeEventInput,
} from "./shape.ts";

const LEAD = "6f1c2b9e-4a3d-4e8f-9b21-0c5d7e8f9a10";
const ACTION_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OPP = "11111111-2222-4333-8444-555555555555";
const SEND = "99999999-8888-4777-8666-555555555555";

const base = { actor_type: "agent", actor: "simon", action: "lead.captured" } as const;

function params(query: Record<string, string>) {
  return new URLSearchParams(query);
}

/** Every string in an event's payload and evidence, for the receipt rule. */
function receiptStrings(event: HomeEventInput): string[] {
  return [...Object.values(event.payload || {}), ...Object.values(event.evidence || {})].filter(
    (v): v is string => typeof v === "string"
  );
}

/** Fails when an event a builder emits breaks the receipt rule. */
function assertReceipt(event: HomeEventInput | null | undefined, label: string) {
  assert.ok(event, `${label}: no event`);
  assert.deepEqual(receiptProblems(event.payload || {}), [], `${label}: payload`);
  assert.deepEqual(receiptProblems(event.evidence || {}), [], `${label}: evidence`);
  for (const value of receiptStrings(event)) assert.ok(!value.includes("@"), `${label}: ${value} contains @`);
  assert.ok(!event.actor.includes("@"), `${label}: actor contains @`);
  const checked = validateHomeEvent(event);
  assert.ok(checked.ok, `${label}: ${checked.ok ? "" : checked.error}`);
  if (checked.ok) {
    assert.deepEqual(checked.event.payload, event.payload || {}, `${label}: the net dropped a payload field`);
    assert.deepEqual(checked.event.evidence, event.evidence || {}, `${label}: the net dropped an evidence field`);
  }
}

// ── Vocabulary and shape ─────────────────────────────────────────────────────

test("the action vocabulary is noun.verb, unique, and matches the migration's check", () => {
  assert.equal(new Set(HOME_EVENT_ACTIONS).size, HOME_EVENT_ACTIONS.length);
  for (const action of HOME_EVENT_ACTIONS) assert.match(action, /^[a-z_]+\.[a-z_]+$/, action);
  for (const wanted of [
    "lead.captured", "lead.updated", "deal.moved", "email.sent", "email.simulated", "article.published",
    "approval.proposed", "approval.granted", "approval.executed", "key.minted", "key.revoked",
  ]) {
    assert.ok(isHomeEventAction(wanted), wanted);
  }
});

test("validateHomeEvent accepts a well-formed event and fills defaults", () => {
  const checked = validateHomeEvent({ ...base, subject_type: "lead", subject_id: LEAD, lead_id: LEAD });
  assert.deepEqual(checked, {
    ok: true,
    event: {
      actor_type: "agent", actor: "simon", action: "lead.captured",
      subject_type: "lead", subject_id: LEAD, lead_id: LEAD, payload: {}, evidence: {},
    },
  });
});

test("validateHomeEvent refuses actions outside the allow-list", () => {
  for (const action of ["lead.deleted", "LEAD.CAPTURED", "lead", "", undefined, 42]) {
    const checked = validateHomeEvent({ ...base, action });
    assert.equal(checked.ok, false, String(action));
    if (!checked.ok) assert.match(checked.error, /unknown action/);
  }
});

test("validateHomeEvent refuses a bad actor, lead_id, subject or payload", () => {
  const bad: Record<string, unknown>[] = [
    { ...base, actor_type: "robot" },
    { ...base, actor: "" },
    { ...base, actor: "   " },
    { ...base, actor: "x".repeat(201) },
    { ...base, actor: "ana@example.com" },
    { ...base, lead_id: "not-a-uuid" },
    { ...base, subject_id: 12 },
    { ...base, subject_id: "ana@example.com" },
    { ...base, subject_id: "has spaces" },
    { ...base, subject_type: "Lead Record" },
    { ...base, payload: [1, 2] },
    { ...base, payload: "text" },
  ];
  for (const event of bad) assert.equal(validateHomeEvent(event).ok, false, JSON.stringify(event).slice(0, 80));
  assert.equal(validateHomeEvent(null).ok, false);
  assert.equal(validateHomeEvent("lead.captured").ok, false);
});

test("validateHomeEvent keeps personal data and secrets out, whatever the caller passes", () => {
  const checked = validateHomeEvent({
    ...base,
    payload: {
      title: "Follow up with Ana", subject: "Hi Ana", email: "ana@example.com", name: "Ana",
      lost_reason: "too pricey", api_key: "k", nested: { keep: 1 }, list: [1],
      opportunity_id: OPP, status: "won", kind: "hot_lead", added_tag_count: 2, auto: true, slug: "a-post",
      workflow_id: "bad id with spaces", type: "not-an-enum",
    },
    evidence: { buzz_event_id: "evt_1", webhook_secret: "s", email_id: "ana@example.com" },
  });
  assert.ok(checked.ok);
  if (!checked.ok) return;
  assert.deepEqual(checked.event.payload, {
    opportunity_id: OPP, status: "won", kind: "hot_lead", added_tag_count: 2, auto: true, slug: "a-post",
  });
  assert.deepEqual(checked.event.evidence, { buzz_event_id: "evt_1" });
});

test("receiptProblems names every field that breaks the rule", () => {
  assert.deepEqual(receiptProblems({ lead_id: LEAD, status: "open", count: 3, ok: false, none: null }), []);
  assert.deepEqual(receiptProblems({ title: "x", status: "maybe", send_id: "a@b", kind: "Hot Lead", n: Infinity, o: {} }), [
    "title: free text", "status: not one of status's values", "send_id: contains @", "kind: not a code constant",
    "n: not a finite number", "o: not a scalar",
  ]);
  assert.deepEqual(receiptSafe({ title: "x", lead_id: LEAD, gone: undefined }), { lead_id: LEAD });
});

// ── The receipt rule, one builder per emit point ─────────────────────────────

test("leadUpsertEvent: captured vs updated, ids and a count only", () => {
  const captured = leadUpsertEvent({ actor_type: "webhook", actor: "capture:funnel-secret" }, LEAD, true, 2);
  assert.deepEqual(captured, {
    actor_type: "webhook", actor: "capture:funnel-secret", action: "lead.captured",
    subject_type: "lead", subject_id: LEAD, lead_id: LEAD, payload: { added_tag_count: 2 },
  });
  assertReceipt(captured, "lead.captured");
  const updated = leadUpsertEvent(actorFromLabel("skool-pull"), LEAD, false, 0);
  assert.equal(updated.action, "lead.updated");
  assert.deepEqual(updated.payload, { added_tag_count: 0 });
  assertReceipt(updated, "lead.updated");
});

test("eventFromActivity: stage moves and sends become events, text stays on the timeline", () => {
  assert.equal(eventFromActivity({ lead_id: LEAD, activity_type: "note", title: "x" }), null);
  assert.equal(eventFromActivity({ lead_id: LEAD, activity_type: "created", title: "x" }), null);

  const moved = eventFromActivity({
    lead_id: LEAD, activity_type: "stage_changed", title: "Moved to stage: Call booked",
    data: { opportunity_id: OPP, stage_id: "stage-2", auto: true }, actor: "user:abc",
  });
  assert.deepEqual(moved, {
    actor_type: "human", actor: "abc", action: "deal.moved",
    subject_type: "opportunity", subject_id: OPP, lead_id: LEAD,
    payload: { opportunity_id: OPP, stage_id: "stage-2", auto: true },
  });
  assertReceipt(moved, "deal.moved");

  const sent = eventFromActivity({
    lead_id: LEAD, activity_type: "email_sent", title: "Email sent: Hi Ana",
    data: { send_id: SEND, resend_id: "re_9", workflow_id: "wf-1" },
  });
  assert.equal(sent?.action, "email.sent");
  assert.equal(sent?.subject_id, SEND);
  assert.deepEqual(sent?.payload, { workflow_id: "wf-1" });
  assert.deepEqual(sent?.evidence, { email_id: "re_9", send_id: SEND });
  assertReceipt(sent, "email.sent");

  const simulated = eventFromActivity({
    lead_id: LEAD, activity_type: "email_sent", title: "Simulated (safe mode, agent-drafted): Hi Ana",
    data: { send_id: SEND, simulated: true, agent_action_id: ACTION_ID, preview_to: "owner@example.com" },
    actor: "agent:operator",
  });
  assert.equal(simulated?.action, "email.simulated");
  assert.deepEqual(simulated?.payload, {});
  assert.deepEqual(simulated?.evidence, { send_id: SEND, agent_action_id: ACTION_ID });
  assertReceipt(simulated, "email.simulated");
});

test("stage_changed activities carrying won / lost / open become deal.won / deal.lost / deal.reopened", () => {
  // The Operator's close path (move_opportunity_stage with close_as) and the
  // dashboard's status PATCH both log stage_changed with data.status.
  const won = eventFromActivity({
    lead_id: LEAD, activity_type: "stage_changed", title: "Deal won: Ana Smith",
    data: { opportunity_id: OPP, status: "won" }, actor: "agent:operator",
  });
  assert.deepEqual(won, {
    actor_type: "agent", actor: "operator", action: "deal.won",
    subject_type: "opportunity", subject_id: OPP, lead_id: LEAD,
    payload: { opportunity_id: OPP, status: "won" },
  });
  assertReceipt(won, "deal.won");
  const lost = eventFromActivity({
    lead_id: LEAD, activity_type: "stage_changed", title: "Deal lost: Ana (too pricey)",
    data: { opportunity_id: OPP, status: "lost" }, actor: "human",
  });
  assert.equal(lost?.action, "deal.lost");
  assertReceipt(lost, "deal.lost");
  const reopened = eventFromActivity({ lead_id: LEAD, activity_type: "stage_changed", title: "", data: { status: "open" } });
  assert.equal(reopened?.action, "deal.reopened");
});

test("dealWonEvent: Skool and event-booking wins carry the id that proves them", () => {
  const skool = dealWonEvent({ actor_type: "system", actor: "conversions" }, {
    opportunityId: OPP, leadId: LEAD, via: "skool", created: false, valueCents: 4900,
    evidence: { skool_user_id: "abc123", first_name: "Ana", email: "ana@example.com" },
  });
  assert.deepEqual(skool, {
    actor_type: "system", actor: "conversions", action: "deal.won",
    subject_type: "opportunity", subject_id: OPP, lead_id: LEAD,
    payload: { opportunity_id: OPP, status: "won", via: "skool", created: false, value_cents: 4900 },
    evidence: { skool_user_id: "abc123" },
  });
  assertReceipt(skool, "deal.won skool");
  const booking = dealWonEvent({ actor_type: "webhook", actor: "stripe" }, {
    opportunityId: OPP, leadId: LEAD, via: "event_booking", created: true, valueCents: 120000,
    evidence: { stripe_session_id: "cs_live_a1B2c3D4e5F6" },
  });
  assert.deepEqual(booking.evidence, { stripe_session_id: "cs_live_a1B2c3D4e5F6" });
  assertReceipt(booking, "deal.won booking");
});

test("articlePublishedEvent: id, slug and calendar entry, never the title", () => {
  const event = articlePublishedEvent({ actor_type: "agent", actor: "content_agent" }, {
    id: OPP, slug: "why-owned-beats-rented", calendarEntryId: ACTION_ID, agentActionId: null,
  });
  assert.deepEqual(event, {
    actor_type: "agent", actor: "content_agent", action: "article.published",
    subject_type: "article", subject_id: OPP,
    payload: { slug: "why-owned-beats-rented", calendar_entry_id: ACTION_ID }, evidence: {},
  });
  assertReceipt(event, "article.published");
  assert.deepEqual(articlePublishedEvent(TELEGRAM_OWNER, { id: OPP, slug: "Not A Slug" }).payload, {});
});

test("agentKeyEvent: the key's name only, never the key, its prefix or its scopes", () => {
  const key = {
    id: ACTION_ID, name: "simon", scopes: ["leads:read"],
    plaintext: `bbk_simon_${"a".repeat(32)}`, key_prefix: "bbk_simon_aaaa",
  };
  const minted = agentKeyEvent({ actor_type: "human", actor: "user-1" }, "key.minted", key);
  assert.deepEqual(minted, {
    actor_type: "human", actor: "user-1", action: "key.minted",
    subject_type: "agent_key", subject_id: ACTION_ID, payload: { key_name: "simon" },
  });
  assertReceipt(minted, "key.minted");
  assertReceipt(agentKeyEvent(actorFromLabel("master"), "key.revoked", { id: ACTION_ID, name: "simon" }), "key.revoked");
});

test("approvalEvent: the decider, the lead, provenance and an outcome enum; no title or result text", () => {
  const action = {
    id: ACTION_ID, type: "email", title: "Follow up with Ana", run_id: null,
    payload: { lead_id: LEAD, subject: "Hi", body_md: "long", buzz_event_id: "evt_42", api_token: "t", email: "ana@example.com" },
  };
  const granted = approvalEvent(action, "approval.granted", TELEGRAM_OWNER);
  assert.deepEqual(granted, {
    actor_type: "human", actor: "telegram", action: "approval.granted",
    subject_type: "approval", subject_id: ACTION_ID, lead_id: LEAD,
    payload: { type: "email" },
    evidence: { agent_action_id: ACTION_ID, buzz_event_id: "evt_42" },
  });
  assertReceipt(granted, "approval.granted");

  const dashboard = actorFromAuth({ authenticated: true, mode: "session", userId: "user-1", role: "admin" });
  const executed = approvalEvent(action, "approval.executed", dashboard, {
    mode: "safe", status: "simulated", intended_recipient: "ana@example.com", preview_sent_to: "owner@example.com",
  });
  assert.equal(executed.actor, "user-1");
  assert.deepEqual(executed.payload, { type: "email", outcome: "simulated" });
  assertReceipt(executed, "approval.executed");

  const failed = approvalEvent(action, "approval.failed", TELEGRAM_OWNER, { error: "Lead no longer exists" });
  assert.deepEqual(failed.payload, { type: "email", outcome: "failed" });
  assertReceipt(failed, "approval.failed");

  const other = approvalEvent(
    { id: ACTION_ID, type: "other", title: "t", payload: { alert_kind: "hot_lead" }, run_id: OPP },
    "approval.rejected",
    { actor_type: "agent", actor: "operator" }
  );
  assert.equal(other.lead_id, null);
  assert.deepEqual(other.payload, { type: "other", kind: "hot_lead", run_id: OPP });
  assertReceipt(other, "approval.rejected");
});

test("approvalOutcome reduces every executor's result to one enum", () => {
  const cases: [unknown, string][] = [
    [{ mode: "live", status: "sent", sendId: SEND }, "sent"],
    [{ mode: "safe", status: "simulated" }, "simulated"],
    [{ published: true, slug: "x", title: "Ana's story" }, "published"],
    [{ published: 2, processing: 0, failed: 0 }, "published"],
    [{ scheduled: true, post_id: OPP }, "scheduled"],
    [{ activated: true, workflow_id: OPP, name: "Welcome" }, "activated"],
    [{ activated: true, already_active: true }, "already_done"],
    [{ already: "published", post_id: OPP }, "already_done"],
    [{ acknowledged: true }, "acknowledged"],
    [{ ok: true, linked: true }, "confirmed"],
    [{ error: "boom" }, "failed"],
    [null, "done"],
    [{ something: "else" }, "done"],
  ];
  for (const [result, outcome] of cases) assert.equal(approvalOutcome(result), outcome, JSON.stringify(result));
});

test("TELEGRAM_OWNER is the human owner, not the Operator", () => {
  assert.deepEqual(TELEGRAM_OWNER, { actor_type: "human", actor: "telegram" });
});

test("deciderForChannel: only the Telegram channel is the owner; every other caller is the agent", () => {
  assert.deepEqual(deciderForChannel("telegram", "hermes"), TELEGRAM_OWNER);
  assert.deepEqual(deciderForChannel("operator"), { actor_type: "agent", actor: "operator" });
  assert.deepEqual(deciderForChannel("server"), { actor_type: "agent", actor: "operator" });
  assert.deepEqual(deciderForChannel("server", "master"), { actor_type: "agent", actor: "master" });
  assert.deepEqual(deciderForChannel(undefined, "simon"), { actor_type: "agent", actor: "simon" });
  assert.deepEqual(deciderForChannel("server", "Not A Name@x"), { actor_type: "agent", actor: "operator" });
});

test("provenanceFromPayload copies only the known provenance keys, as ids", () => {
  assert.deepEqual(
    provenanceFromPayload({ buzz_event_id: "e1", request_id: 7, webhook_id: "", email_id: "a@b.c", other: "x" }),
    { buzz_event_id: "e1", request_id: "7" }
  );
  assert.deepEqual(provenanceFromPayload(null), {});
  assert.deepEqual(provenanceFromPayload([1]), {});
});

// ── Cursor ───────────────────────────────────────────────────────────────────

test("cursors round-trip and stay opaque base64url", () => {
  for (const seq of [0, 1, 41, 500, 1_000_000, Number.MAX_SAFE_INTEGER]) {
    const cursor = encodeCursor(seq);
    assert.match(cursor, /^[A-Za-z0-9_-]+$/);
    assert.equal(decodeCursor(cursor), seq);
  }
  assert.notEqual(encodeCursor(2), encodeCursor(3));
});

test("decodeCursor refuses anything this feed did not issue", () => {
  // Built with the same unpadded base64url as real cursors, so each case is
  // refused for its content, not for a stray '=' or '+'.
  const foreign = ["he2:5", "he1:-1", "he1:12a", "he1:", "HE1:5", "xx1:5", "he1:5 ", "he1:12345678901234567", "5", "seq:5"];
  for (const text of foreign) {
    const cursor = toBase64Url(text);
    assert.match(cursor, /^[A-Za-z0-9_-]+$/, text);
    assert.equal(decodeCursor(cursor), null, text);
  }
  for (const cursor of [null, undefined, "", "abc$", "a+b/c", "aGUxOjU="]) {
    assert.equal(decodeCursor(cursor), null, String(cursor));
  }
  assert.equal(decodeCursor(toBase64Url("he1:5")), 5);
  assert.throws(() => encodeCursor(-1), RangeError);
  assert.throws(() => encodeCursor(1.5), RangeError);
});

test("parseFeedQuery reads since, limit, action and lead_id", () => {
  assert.deepEqual(parseFeedQuery(params({})), {
    ok: true,
    query: { afterSeq: 0, limit: 100, actionPrefix: null, leadId: null },
  });
  assert.deepEqual(
    parseFeedQuery(params({ since: encodeCursor(77), limit: "500", action: "approval.", lead_id: LEAD })),
    { ok: true, query: { afterSeq: 77, limit: 500, actionPrefix: "approval.", leadId: LEAD } }
  );
  assert.equal(parseFeedQuery(params({ action: "lead" })).ok, true);
  assert.equal(parseFeedQuery(params({ action: "approval.granted" })).ok, true);
});

test("parseFeedQuery refuses malformed input", () => {
  const bad: Record<string, string>[] = [
    { since: "nonsense" },
    { limit: "0" },
    { limit: String(FEED_MAX_LIMIT + 1) },
    { limit: "ten" },
    { limit: "-5" },
    { action: "lead%" },
    { action: "Lead." },
    { action: "a.b.c" },
    { lead_id: "42" },
  ];
  for (const query of bad) {
    assert.equal(parseFeedQuery(params(query)).ok, false, JSON.stringify(query));
  }
});

// ── Redaction ────────────────────────────────────────────────────────────────

test("redactSecrets drops secret-looking keys at any depth and keeps provenance", () => {
  const input = {
    title: "Welcome",
    api_key: "k",
    API_SECRET: "s",
    session_cookie: "c",
    password: "p",
    access_token: "t",
    agent_key: "bbk",
    key_prefix: "bbk_simon_1a2b",
    buzz_event_id: "evt_9",
    email_id: "re_1",
    list: [{ secret_value: 1, ok: true }, "plain"],
    deep: { deeper: { stripe_webhook_secret: "x", count: 3 } },
  };
  assert.deepEqual(redactSecrets(input), {
    title: "Welcome",
    key_prefix: "bbk_simon_1a2b",
    buzz_event_id: "evt_9",
    email_id: "re_1",
    list: [{ ok: true }, "plain"],
    deep: { deeper: { count: 3 } },
  });
});

test("redactSecrets replaces credential-shaped values whatever their key", () => {
  const minted = `bbk_simon_${"a1".repeat(16)}`;
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl";
  assert.deepEqual(redactSecrets({ note: minted, header: "Bearer abc.def", raw: jwt, plain: "bbk_simon_1a2b" }), {
    note: REDACTED,
    header: REDACTED,
    raw: REDACTED,
    plain: "bbk_simon_1a2b",
  });
  assert.equal(redactSecrets(null), null);
  assert.equal(redactSecrets(7), 7);
});

// ── Actors ───────────────────────────────────────────────────────────────────

test("actorFromAuth: a session is the human, every key is an agent named by its key", () => {
  const session: AuthResult = { authenticated: true, mode: "session", userId: "user-123", role: "admin" };
  const master: AuthResult = { authenticated: true, mode: "api-key", agent: "master", scopes: ["*"] };
  const envKey: AuthResult = { authenticated: true, mode: "api-key", agent: "hermes", scopes: ["*"] };
  const minted: AuthResult = { authenticated: true, mode: "api-key", agent: "simon", scopes: ["events:read"] };
  const legacy: AuthResult = { authenticated: true, mode: "api-key", agent: "master" };
  const nobody: AuthResult = { authenticated: false, error: "Not authenticated" };

  assert.deepEqual(actorFromAuth(session), { actor_type: "human", actor: "user-123" });
  assert.deepEqual(actorFromAuth(master), { actor_type: "agent", actor: "master" });
  assert.deepEqual(actorFromAuth(envKey), { actor_type: "agent", actor: "hermes" });
  assert.deepEqual(actorFromAuth(minted), { actor_type: "agent", actor: "simon" });
  assert.deepEqual(actorFromAuth(legacy), { actor_type: "agent", actor: "master" });
  assert.deepEqual(actorFromAuth(nobody), { actor_type: "system", actor: "anonymous" });
});

test("actorFromLabel maps the CRM's existing actor strings", () => {
  const cases: [string | undefined, string, string][] = [
    [undefined, "system", "system"],
    ["", "system", "system"],
    ["system", "system", "system"],
    ["cron", "system", "cron"],
    ["agent:operator", "agent", "operator"],
    ["agent:tumi", "agent", "tumi"],
    ["operator", "agent", "operator"],
    ["master", "agent", "master"],
    ["user:abc", "human", "abc"],
    ["human", "human", "human"],
    ["lead", "human", "lead"],
    ["capture:funnel-secret", "webhook", "capture:funnel-secret"],
    ["calcom", "webhook", "calcom"],
    ["webhook:stripe", "webhook", "stripe"],
    ["workflow:wf-1", "system", "workflow:wf-1"],
    ["skool-pull", "system", "skool-pull"],
    ["conversion-radar", "system", "conversion-radar"],
  ];
  for (const [label, actorType, actor] of cases) {
    assert.deepEqual(actorFromLabel(label), { actor_type: actorType, actor }, String(label));
  }
});
