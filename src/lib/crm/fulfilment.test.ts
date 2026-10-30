import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { fakeDb, type FakeDb } from "../money/fake-db.ts";
import type { MoneyClient } from "../money/db.ts";
import { createEngagementFromDeal, type Engagement } from "../money/engagements.ts";
import { engagementStageChanged, tagDeliveredWhenComplete } from "./fulfilment.ts";
import { FULFILMENT_RECIPES, ONBOARDING_NAME, ONBOARDING_SETTING, PROJECT_STAGES, seedFulfilmentRecipes, fulfilmentRecipeState } from "./fulfilment-seed.ts";
import type { AdminClient, CrmSettings, Enrollment, Lead, Workflow, WorkflowStep } from "./types.ts";
import type { TickSummary } from "./engine.ts";

const admin = (db: FakeDb) => db as unknown as AdminClient;
const money = (db: FakeDb) => db as unknown as MoneyClient;
const LEAD = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const DELIVERY = "33333333-3333-4333-8333-333333333333";

// Run the actual TS engine and route handlers with explicit boundary doubles.
// This avoids loading Next/Worker providers in node --test, without copying
// trigger matching, enrollment, step execution or route logic into the tests.
function moduleUnderTest<T>(file: string, dependencies: Record<string, unknown>, expose = ""): T {
  const source = readFileSync(new URL(file, import.meta.url), "utf8") + expose;
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", js)((id: string) => {
    if (!(id in dependencies)) throw new Error(`Unmocked dependency: ${id}`);
    return dependencies[id];
  }, loaded, loaded.exports);
  return loaded.exports as T;
}

const merge = moduleUnderTest<typeof import("./merge.ts")>("./merge.ts", {});
const settings: CrmSettings = {
  safe_mode: true, sender: { from_name: "Test Home", from_email: "hello@example.com" },
  send_window: { enabled: false, start_hour: 9, end_hour: 17, timezone: "UTC", days: [] },
  send_budget: { enabled: false, daily_limit: 100, per_tick_limit: 100, max_bounce_rate: 0.1,
    max_complaint_rate: 0.1, breaker_min_sends: 10, exempt_workflow_ids: [], suppress_tags: [] },
  capture_key: null, funnel_secret: null,
};
const activity = { logActivity: async () => {} };
const email = moduleUnderTest<typeof import("./email.ts")>("./email.ts", {
  "./merge": merge, "./activity": activity, "./settings": { getCrmSettings: async () => settings },
  "./markdown": { renderEmailHtml: ({ bodyMd }: { bodyMd: string }) => bodyMd },
});
const engine = moduleUnderTest<typeof import("./engine.ts") & {
  executeStep: (db: AdminClient, step: WorkflowStep, lead: Lead, workflow: Workflow, enrollment: Enrollment,
    index: number, settings: CrmSettings, summary: TickSummary) => Promise<{ advance: boolean; deferUntil?: Date }>;
}>("./engine.ts", {
  "./activity": activity, "@/lib/money/engagements": {}, "@/lib/money/db": {}, "@/lib/money/state": {},
  "./email": email, "./settings": {}, "./merge": merge, "./scoring": {}, "./alerts": {}, "./abtest": {},
  "./retention": { SKOOL_TAGS: [] }, "./bookings": {}, "./health": {}, "./pagination": {},
  "./types": { parseSteps: (steps: unknown) => steps },
}, "\nexport { executeStep };\n");

function fixture() {
  return fakeDb({
    leads: [{ id: LEAD, first_name: "Alex", email: "alex@example.com", tags: ["customer"], custom: {}, email_status: "subscribed", unsubscribe_token: "test" }],
    engagements: [{ id: PROJECT, lead_id: LEAD, name: "Alex's website", stage: "brief", status: "active" }],
    backend_settings: [{ key: "crm_auto_pipeline", value: false }],
  });
}

function summary(): TickSummary {
  return { emails_sent: 0, emails_simulated: 0, emails_suppressed: 0, breaker_paused_workflows: [], budget_remaining: null } as unknown as TickSummary;
}

async function sendEnrollment(db: FakeDb, index = 0) {
  const enrollment = db.rows("workflow_enrollments")[index] as unknown as Enrollment;
  const workflow = db.rows("workflows").find((w) => w.id === enrollment.workflow_id) as unknown as Workflow;
  const lead = db.rows("leads")[0] as unknown as Lead;
  const result = summary();
  await engine.executeStep(admin(db), (workflow.steps as unknown as WorkflowStep[])[0], lead, workflow, enrollment, 0, settings, result);
  return result;
}

test("seeding twice preserves existing custom recipes and ids, preserves all statuses and custom onboarding, and enables nothing", async () => {
  const db = fixture();
  const first = await seedFulfilmentRecipes(admin(db));
  assert.equal(FULFILMENT_RECIPES.length, 3);
  assert.equal(first.workflows.length, 9);
  assert.equal(first.templates.length, 12);
  assert.ok(first.workflows.every((wf) => wf.created && wf.status === "draft"));
  assert.equal(db.rows("backend_settings").find((r) => r.key === ONBOARDING_SETTING)?.value,
    first.workflows.find((w) => w.name === ONBOARDING_NAME)?.id);
  const states = ["active", "paused", "archived", "draft"];
  db.rows("workflows").forEach((wf, i) => { wf.status = states[i % states.length]; });
  db.rows("email_templates")[0].body_md = "My custom welcome";
  db.rows("backend_settings").find((r) => r.key === ONBOARDING_SETTING)!.value = { name: "Owner's onboarding" };
  db.rows("workflows")[0].steps = [{id:"custom",type:"wait",config:{days:42}}];
  db.rows("workflows")[0].description = "Member-edited workflow";
  const second = await seedFulfilmentRecipes(admin(db));
  assert.equal(db.rows("workflows")[0].description, "Member-edited workflow");
  assert.deepEqual(db.rows("workflows")[0].steps, [{id:"custom",type:"wait",config:{days:42}}]);
  assert.deepEqual(second.workflows.map((wf) => wf.id), first.workflows.map((wf) => wf.id));
  assert.deepEqual(second.templates.map((tpl) => tpl.id), first.templates.map((tpl) => tpl.id));
  assert.ok(second.workflows.every((wf, i) => !wf.created && wf.status === states[i % states.length]));
  assert.ok(second.templates.every((tpl) => !tpl.created));
  assert.equal(db.rows("email_templates")[0].body_md, "My custom welcome");
  assert.deepEqual(db.rows("backend_settings").find((r) => r.key === ONBOARDING_SETTING)?.value, { name: "Owner's onboarding" });
  assert.equal(db.rows("workflow_enrollments").length, 0);
  assert.equal(db.rows("email_sends").length, 0);
  const state = await fulfilmentRecipeState(admin(db));
  assert.ok(state.every((recipe) => recipe.workflows.every((wf) => wf.seeded)));
});

test("onboarding fills an unset setting and preserves a concurrent owner's setting", async () => {
  for (const value of [null, ""]) {
    const db = fixture();
    db.rows("backend_settings").push({ key: ONBOARDING_SETTING, value });
    await seedFulfilmentRecipes(admin(db));
    assert.equal(typeof db.rows("backend_settings").find((r) => r.key === ONBOARDING_SETTING)?.value, "string");
    assert.ok(db.rows("backend_settings").find((r) => r.key === ONBOARDING_SETTING)?.value);
  }
  const db = fixture();
  db.beforeCall = (table, op) => {
    if (table === "backend_settings" && op === "insert") {
      db.rows(table).push({ key: ONBOARDING_SETTING, value: "owner-workflow" });
      db.beforeCall = null;
    }
  };
  await seedFulfilmentRecipes(admin(db));
  assert.equal(db.rows("backend_settings").find((r) => r.key === ONBOARDING_SETTING)?.value, "owner-workflow");
});

test("failed seed lookups throw instead of creating duplicates", async () => {
  const db = fixture();
  await seedFulfilmentRecipes(admin(db));
  db.failWhen = (table, op) => table === "workflows" && op === "select";
  await assert.rejects(seedFulfilmentRecipes(admin(db)), /workflow lookup/);
  assert.equal(db.rows("workflows").length, 9);
});

test("recipe steps have the specified delays, tags, stage matching and reenrollment rules", async () => {
  const db = fixture();
  await seedFulfilmentRecipes(admin(db));
  const onboarding = db.rows("workflows").find((w) => w.name === ONBOARDING_NAME)!;
  const steps = onboarding.steps as WorkflowStep[];
  assert.deepEqual(steps.map((s) => s.type), ["send_email", "wait", "send_email", "wait", "send_email"]);
  assert.deepEqual(steps.filter((s) => s.type === "wait").map((s) => s.config.days), [2, 5]);
  assert.equal(onboarding.allow_reenrollment, false);
  const review = db.rows("workflows").find((w) => (w.trigger_config as { tag?: string }).tag === "delivered")!;
  assert.deepEqual((review.steps as WorkflowStep[]).map((s) => s.type), ["send_email", "wait", "send_email", "add_tag"]);
  assert.equal((review.steps as WorkflowStep[])[1].config.days, 7);
  assert.equal((review.steps as WorkflowStep[])[3].config.tag, "review-requested");
  for (const stage of Object.keys(PROJECT_STAGES)) {
    const wf = db.rows("workflows").find((w) => (w.trigger_config as { stage?: string }).stage === stage)!;
    assert.equal(wf.trigger_type, "engagement_stage_changed");
    assert.equal(wf.allow_reenrollment, true);
    assert.equal((wf.steps as WorkflowStep[]).length, 1);
  }
});

test("draft recipes never enroll; active stage events match only their stage and snapshot project merge values", async () => {
  const db = fixture();
  await seedFulfilmentRecipes(admin(db));
  const engagement = db.rows("engagements")[0] as unknown as Engagement;
  engagement.stage = "research";
  await engagementStageChanged(money(db), engagement, "brief", engine.fireTrigger);
  await engine.fireTrigger(admin(db), { type: "tag_added", lead: db.rows("leads")[0] as unknown as Lead, data: { tag: "customer" } });
  await engine.fireTrigger(admin(db), { type: "tag_added", lead: db.rows("leads")[0] as unknown as Lead, data: { tag: "delivered" } });
  assert.equal(db.rows("workflow_enrollments").length, 0);
  db.rows("workflows").forEach((w) => { w.status = "active"; });
  await engagementStageChanged(money(db), engagement, "brief", engine.fireTrigger);
  assert.equal(db.rows("workflow_enrollments").length, 1);
  const context = db.rows("workflow_enrollments")[0].context as Record<string, unknown>;
  assert.equal(context.engagement_id, PROJECT);
  assert.equal(context.stage, "research");
  assert.equal(context.previous_stage, "brief");
  assert.equal(context.engagement_name, "Alex's website");
  engagement.name = "Changed after event";
  const result = await sendEnrollment(db);
  assert.equal(result.emails_simulated, 1);
  assert.match(String(db.rows("email_sends")[0].body_html), /Hi Alex,[\s\S]*Alex's website/);
  assert.deepEqual(db.rows("leads")[0].custom, {});
  assert.equal(db.rows("email_sends")[0].status, "simulated");
  // A second, different stage before the first workflow finishes still enrolls.
  engagement.stage = "copy";
  await engagementStageChanged(money(db), engagement, "research", engine.fireTrigger);
  assert.equal(db.rows("workflow_enrollments").length, 2);
  await engagementStageChanged(money(db), engagement, "copy", engine.fireTrigger);
  assert.equal(db.rows("workflow_enrollments").length, 2);
});

test("stage config empty means any; completed stage workflows can reenroll, other workflows retain their rules", async () => {
  const db = fixture();
  await seedFulfilmentRecipes(admin(db));
  const wf = db.rows("workflows").find((w) => (w.trigger_config as { stage?: string }).stage === "brief")!;
  wf.status = "active";
  wf.trigger_config = { stage: "" };
  const engagement = { ...db.rows("engagements")[0], stage: "launch" } as unknown as Engagement;
  await engagementStageChanged(money(db), engagement, "build", engine.fireTrigger);
  assert.equal(db.rows("workflow_enrollments").length, 1);
  db.rows("workflow_enrollments")[0].status = "completed";
  await engagementStageChanged(money(db), engagement, "build", engine.fireTrigger);
  assert.equal(db.rows("workflow_enrollments").length, 2);
  const purchase = db.rows("workflows").find((w) => w.name === ONBOARDING_NAME)!;
  purchase.status = "active";
  const lead = db.rows("leads")[0] as unknown as Lead;
  await engine.fireTrigger(admin(db), { type: "tag_added", lead, data: { tag: "customer" } });
  db.rows("workflow_enrollments").find((e) => e.workflow_id === purchase.id)!.status = "completed";
  await engine.fireTrigger(admin(db), { type: "tag_added", lead, data: { tag: "customer" } });
  assert.equal(db.rows("workflow_enrollments").filter((e) => e.workflow_id === purchase.id).length, 1);
});

test("won deal creation fires brief exactly once through the real trigger path", async () => {
  const db = fixture();
  await seedFulfilmentRecipes(admin(db));
  db.rows("workflows").forEach((w) => { w.status = "active"; });
  db.rows("opportunities").push({ id: "deal", lead_id: LEAD, name: "New website", value_cents: 50000, currency: "AUD" });
  const first = await createEngagementFromDeal(money(db), { opportunityId: "deal" }, engine.fireTrigger);
  const second = await createEngagementFromDeal(money(db), { opportunityId: "deal" }, engine.fireTrigger);
  assert.equal(first.ok && first.created, true);
  assert.equal(second.ok && second.created, false);
  assert.equal(db.rows("workflow_enrollments").length, 1);
  const context = db.rows("workflow_enrollments")[0].context as Record<string, unknown>;
  assert.equal(context.stage, "brief");
  assert.equal(context.previous_stage, null);
});

function routeDeps(db: FakeDb, auth: unknown = { authenticated: true, mode: "session", role: "admin" }) {
  return {
    "next/server": { NextResponse: { json: (data: unknown, init?: ResponseInit) => Response.json(data, init) } },
    "@/lib/api/auth": { authenticateSessionOrApiKey: async () => auth, requireScope: () => null,
      unauthorizedResponse: () => Response.json({ error: "unauthorized" }, { status: 401 }) },
    "@/lib/supabase/server": { createAdminClient: () => admin(db) },
    "@/lib/money/db": { moneyDb: () => money(db) },
    "@/lib/money/route-auth": { readJson: (req: Request) => req.json(), actorOf: () => "human" },
    "@/lib/money/records": { isUuid: (v: unknown) => typeof v === "string", ENGAGEMENT_STAGES: Object.keys(PROJECT_STAGES),
      ENGAGEMENT_STATUSES: ["active", "paused", "won", "lost"], DELIVERABLE_STATUSES: ["todo", "in_progress", "done"] },
    "@/lib/money/money": {}, "@/lib/money/db-util": {}, "@/lib/money/engagements": {},
    "@/lib/crm/activity": activity,
    "@/lib/crm/fulfilment": {
      engagementStageChanged: (client: MoneyClient, engagement: Engagement, before: string) => engagementStageChanged(client, engagement, before, engine.fireTrigger),
      tagDeliveredWhenComplete: (client: MoneyClient, id: string) => tagDeliveredWhenComplete(client, id, engine.fireTrigger),
    },
  };
}
const request = (body: unknown) => new Request("https://example.com/api/crm/test", { method: "PATCH", body: JSON.stringify(body) });

test("engagement PATCH emits only a changed stage, with previous stage and project identity", async () => {
  const db = fixture();
  await seedFulfilmentRecipes(admin(db));
  db.rows("workflows").forEach((w) => { w.status = "active"; });
  const route = moduleUnderTest<{ PATCH: (req: Request) => Promise<Response> }>("../../app/api/crm/engagements/route.ts", routeDeps(db));
  assert.equal((await route.PATCH(request({ id: PROJECT, stage: "research" }))).status, 200);
  assert.equal((await route.PATCH(request({ id: PROJECT, stage: "research", status: "paused" }))).status, 200);
  assert.equal(db.rows("workflow_enrollments").length, 1);
  assert.equal((db.rows("workflow_enrollments")[0].context as Record<string, unknown>).previous_stage, "brief");
});

test("deliverables PATCH tags delivered once, only when the last is done, and enrolls review", async () => {
  const db = fixture();
  await seedFulfilmentRecipes(admin(db));
  db.rows("workflows").forEach((w) => { w.status = "active"; });
  db.rows("engagement_deliverables").push(
    { id: "first", engagement_id: PROJECT, status: "todo" },
    { id: DELIVERY, engagement_id: PROJECT, status: "todo" },
    { id: "unrelated", engagement_id: "other", status: "todo" },
  );
  const route = moduleUnderTest<{ PATCH: (req: Request, params: { params: Promise<{ id: string }> }) => Promise<Response> }>(
    "../../app/api/crm/engagements/[id]/deliverables/route.ts", routeDeps(db));
  const params = { params: Promise.resolve({ id: PROJECT }) };
  await route.PATCH(request({ deliverable_id: "first", status: "done" }), params);
  assert.deepEqual(db.rows("leads")[0].tags, ["customer"]);
  assert.equal((await route.PATCH(request({ deliverable_id: DELIVERY, status: "done" }), params)).status, 200);
  assert.equal((await route.PATCH(request({ deliverable_id: DELIVERY, status: "done" }), params)).status, 200);
  assert.deepEqual(db.rows("leads")[0].tags, ["customer", "delivered"]);
  assert.equal(db.rows("lead_activities").filter((a) => a.activity_type === "tag_added").length, 1);
  assert.equal(db.rows("workflow_enrollments").length, 1);
  assert.equal((await sendEnrollment(db)).emails_simulated, 1);
});

test("completion races fire once, preserve other tags, and handle empty/missing lead/error cases", async () => {
  const db = fixture();
  assert.equal(await tagDeliveredWhenComplete(money(db), PROJECT, engine.fireTrigger), false);
  db.rows("engagement_deliverables").push({ id: DELIVERY, engagement_id: PROJECT, status: "done" });
  let fired = 0;
  const fire = async () => { fired++; return []; };
  db.beforeCall = (table, op) => {
    if (table === "leads" && op === "update") {
      db.rows("leads")[0].tags = ["customer", "vip"];
      db.beforeCall = null;
    }
  };
  await Promise.all([tagDeliveredWhenComplete(money(db), PROJECT, fire), tagDeliveredWhenComplete(money(db), PROJECT, fire)]);
  assert.equal(fired, 1);
  assert.deepEqual(db.rows("leads")[0].tags, ["customer", "vip", "delivered"]);
  db.rows("engagements")[0].lead_id = null;
  assert.equal(await tagDeliveredWhenComplete(money(db), PROJECT, fire), false);
  db.failWhen = (table, op) => table === "engagement_deliverables" && op === "select";
  await assert.rejects(tagDeliveredWhenComplete(money(db), PROJECT, fire), /deliverables count/);
});

test("fulfilment API rejects non-owner keys and bad actions, GET reports drafts after POST", async () => {
  const db = fixture();
  const load = (auth?: unknown) => moduleUnderTest<{ GET: (req: Request) => Promise<Response>; POST: (req: Request) => Promise<Response> }>(
    "../../app/api/crm/fulfilment/route.ts", {
      ...routeDeps(db, auth), "@/lib/crm/fulfilment-seed": { seedFulfilmentRecipes, fulfilmentRecipeState },
    });
  const denied = load({ authenticated: true, mode: "api-key", agent: "writer", scopes: ["*"] });
  assert.equal((await denied.POST(request({ action: "seed" }))).status, 403);
  assert.equal(db.rows("workflows").length, 0);
  const route = load();
  assert.equal((await route.POST(request({ action: "enable" }))).status, 400);
  const missing = await (await route.GET(request({}))).json();
  assert.ok(missing.recipes.every((r: { workflows: Array<{ seeded: boolean }> }) => r.workflows.every((w) => !w.seeded)));
  assert.equal((await route.POST(request({ action: "seed" }))).status, 200);
  const state = await (await route.GET(request({}))).json();
  assert.ok(state.recipes.every((r: { workflows: Array<{ status: string }> }) => r.workflows.every((w) => w.status === "draft")));
});

test("every recipe email uses safe mode even with a provider key, waits defer, and review ends with its tag", async (t) => {
  const db = fixture();
  await seedFulfilmentRecipes(admin(db));
  const oldKey = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = "test-only-not-a-real-key";
  const transport = t.mock.method(globalThis, "fetch", async () => { throw new Error("safe mode reached a provider"); });
  try {
    const lead = db.rows("leads")[0] as unknown as Lead;
    const result = summary();
    for (const row of db.rows("workflows")) {
      const workflow = row as unknown as Workflow;
      const enrollment = { id: `test-${workflow.id}`, context: { engagement_name: "A specific project" } } as unknown as Enrollment;
      for (const [index, step] of (workflow.steps as unknown as WorkflowStep[]).entries()) {
        const before = Date.now();
        const outcome = await engine.executeStep(admin(db), step, lead, workflow, enrollment, index, settings, result);
        assert.equal(outcome.advance, true);
        if (step.type === "wait") {
          assert.ok(outcome.deferUntil);
          const expected = Number(step.config.days) * 86_400_000;
          assert.ok(outcome.deferUntil.getTime() - before >= expected);
          assert.ok(outcome.deferUntil.getTime() - before < expected + 2000);
        }
      }
    }
    assert.equal(transport.mock.callCount(), 0);
    assert.equal(result.emails_simulated, 12);
    assert.ok(db.rows("email_sends").every((send) => send.status === "simulated"));
    assert.ok((db.rows("leads")[0].tags as string[]).includes("review-requested"));
  } finally {
    if (oldKey === undefined) Reflect.deleteProperty(process.env, "RESEND_API_KEY");
    else process.env.RESEND_API_KEY = oldKey;
  }
});

test("all-deliverables check uses exact counts beyond the usual row cap", async () => {
  const db = fixture();
  db.rows("engagement_deliverables").push(...Array.from({ length: 1001 }, (_, i) => ({
    id: `delivery-${i}`, engagement_id: PROJECT, status: i === 1000 ? "todo" : "done",
  })));
  let fired = 0;
  const fire = async () => { fired++; return []; };
  assert.equal(await tagDeliveredWhenComplete(money(db), PROJECT, fire), false);
  db.rows("engagement_deliverables")[1000].status = "done";
  assert.equal(await tagDeliveredWhenComplete(money(db), PROJECT, fire), true);
  assert.equal(fired, 1);
});
