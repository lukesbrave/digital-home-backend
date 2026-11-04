/**
 * The real handlers, run against a recording fake database and fake
 * Operator/route/brand dependencies: what every tool reads and writes, not
 * what its catalog label claims.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { AdminClient } from "../../crm/types.ts";
import { FakeSupabase } from "../../testing/fake-supabase.ts";
import { handleMcpBody, type RpcResponse } from "../server.ts";
import type { McpCaller, McpToolContext } from "../types.ts";
import { MCP_TOOLS } from "./index.ts";
import { parseTimelineCursor, timelineCursor } from "./leads.ts";

const LEAD = "11111111-1111-4111-8111-111111111111";
const DEAL = "22222222-2222-4222-8222-222222222222";
const STAGE_A = "33333333-3333-4333-8333-333333333331";
const PIPE = "44444444-4444-4444-8444-444444444444";

const MASTER: McpCaller = { agent: "master", scopes: ["*"], kind: "env" };

/** A valid call for every tool in the belt. */
const CALLS: Record<string, Record<string, unknown>> = {
  "home.info": {},
  "home.guide": {},
  "leads.search": {
    query: "ana smith",
    tag: "hot",
    since_days: 30,
    order_by: "score",
  },
  "leads.get": { email: "ana@example.com" },
  "leads.timeline": { lead_id: LEAD, limit: 2 },
  "leads.add_note": {
    email: "ana@example.com",
    note: "Asked about pricing on the call.",
  },
  "pipeline.list": { stalled_only: true },
  "pipeline.move": { opportunity_id: DEAL, stage: "Proposal" },
  "calendar.list": { status: "planned" },
  "article.propose": { title: "Own your home", target_keyword: "digital home" },
  "social.propose": {
    caption: "Your home, your rules",
    media_urls: ["https://cdn.example.com/1.jpg"],
  },
  "brand.playbook.get": {},
  "approvals.list": {},
  "approvals.mine": {},
};

function seeded() {
  return new FakeSupabase(
    {
      leads: [
        {
          id: LEAD,
          email: "ana@example.com",
          first_name: "Ana",
          last_name: "Smith",
          tags: ["hot"],
          score: 40,
          status: "engaged",
          unsubscribe_token: "unsub-capability-secret",
          created_at: "2026-10-20T08:00:00.000Z",
        },
      ],
      lead_activities: [
        {
          id: "aaaaaaaa-0000-4000-8000-000000000003",
          lead_id: LEAD,
          activity_type: "note",
          title: "c",
          created_at: "2026-10-25T08:00:00.123456+00:00",
        },
        {
          id: "aaaaaaaa-0000-4000-8000-000000000002",
          lead_id: LEAD,
          activity_type: "note",
          title: "b",
          created_at: "2026-10-25T08:00:00.123456+00:00",
        },
        {
          id: "aaaaaaaa-0000-4000-8000-000000000001",
          lead_id: LEAD,
          activity_type: "note",
          title: "a",
          created_at: "2026-10-24T08:00:00.000000+00:00",
        },
      ],
      opportunities: [
        {
          id: DEAL,
          name: "Ana: coaching",
          lead_id: LEAD,
          stage_id: STAGE_A,
          pipeline_id: PIPE,
          status: "open",
        },
      ],
      pipeline_stages: [
        { id: STAGE_A, name: "Discovery", pipeline_id: PIPE, position: 1 },
        {
          id: "33333333-3333-4333-8333-333333333332",
          name: "Proposal",
          pipeline_id: PIPE,
          position: 2,
        },
      ],
      agent_actions: [
        {
          id: "act-1",
          type: "email",
          title: "Email ana@example.com: pricing",
          summary: "for Ana Smith",
          status: "proposed",
          payload: { email: "ana@example.com" },
          created_at: "2026-10-25T09:00:00.000Z",
        },
      ],
      content_calendar: [],
      social_posts: [],
    },
    { defaults: { agent_actions: { status: "proposed" } } },
  );
}

function harness(caller: McpCaller = MASTER) {
  const fake = seeded();
  const operatorCalls: string[] = [];
  const routeCalls: Array<{ name: string; query?: Record<string, string> }> =
    [];
  const ctx: McpToolContext = {
    supabase: fake as unknown as AdminClient,
    caller,
    origin: "https://home.example.com",
    runId: "run-1",
    actor: `agent:${caller.agent}`,
    operator: async (name, input) => {
      operatorCalls.push(name);
      if (name === "get_lead") {
        return {
          data: {
            lead: {
              id: LEAD,
              email: input.email,
              unsubscribe_token: "unsub-capability-secret",
              custom: { api_secret: "x" },
            },
          },
          summary: "Read lead",
        };
      }
      return { data: { rows: [] }, summary: `ran ${name}` };
    },
    route: async (name, query) => {
      routeCalls.push({ name, query });
      return name === "home"
        ? { contract: "home_contract_v1", version: "3.0.0" }
        : { email: query?.email, live: null, live_error: "session_missing" };
    },
    loadBrandPlaybooks: async () => [
      { slug: "current", playbook: { voice: "plain" } },
    ],
  };
  const call = async (name: string, args: Record<string, unknown>) => {
    const reply = await handleMcpBody(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
      {
        tools: MCP_TOOLS,
        caller,
        createContext: () => ctx,
      },
    );
    const result = (reply.body as RpcResponse).result as {
      content: { text: string }[];
      isError: boolean;
    };
    return {
      isError: result.isError,
      text: result.content[0].text,
      data: JSON.parse(result.content[0].text),
    };
  };
  return { fake, call, operatorCalls, routeCalls };
}

test("every tool in the belt has a valid call here", () => {
  assert.deepEqual(
    Object.keys(CALLS).sort(),
    MCP_TOOLS.map((t) => t.name).sort(),
  );
});

test("no tool moves, publishes or sends: the only writes are a note and queued proposals", async () => {
  const { fake, call, operatorCalls } = harness();
  for (const [name, args] of Object.entries(CALLS)) {
    const result = await call(name, args);
    assert.equal(result.isError, false, `${name}: ${result.text}`);
  }

  const writes = fake.writes().map((w) => `${w.op} ${w.table}`);
  assert.deepEqual(writes, [
    "insert lead_activities", // leads.add_note
    "update leads", // its last_activity_at
    "insert agent_actions", // pipeline.move
    "insert agent_actions", // article.propose
    "insert agent_actions", // social.propose
  ]);
  const leadUpdate = fake.writes().find((w) => w.table === "leads")!;
  assert.deepEqual(Object.keys(leadUpdate.values as object), [
    "last_activity_at",
  ]);
  for (const row of fake.tables.agent_actions.slice(1)) {
    assert.equal(row.status, "proposed");
    assert.equal(
      (row.payload as { proposed_by: string }).proposed_by,
      "master",
    );
  }
  assert.equal(
    fake.tables.opportunities[0].stage_id,
    STAGE_A,
    "the deal did not move",
  );
  assert.deepEqual(fake.tables.content_calendar, []);
  assert.deepEqual(fake.tables.social_posts, []);
  assert.deepEqual([...new Set(operatorCalls)].sort(), [
    "get_content_calendar",
    "get_lead",
    "list_pipeline",
  ]);
});

test("results never carry secret-shaped fields, on the success path too", async () => {
  const { call } = harness();
  for (const [name, args] of Object.entries(CALLS)) {
    const { text } = await call(name, args);
    // A secret-named field with a credential-shaped value (prose explaining signing may stay).
    assert.doesNotMatch(
      text,
      /"[a-z_]*(token|secret|password|api_key|key_hash|cookie)"\s*:\s*("[^"\s]*"|-?\d|true|false|null)/i,
      name,
    );
    assert.ok(!text.includes("unsub-capability-secret"), name);
  }
  const lead = await call("leads.get", { email: "ana@example.com" });
  assert.deepEqual(lead.data, {
    lead: { id: LEAD, email: "ana@example.com", custom: {} },
  });
  const guide = await call("home.guide", {});
  assert.match(
    guide.data.authentication,
    /sign/i,
    "the guide's prose survives",
  );
});

test("approvals.list shows titles only to keys that may read leads", async () => {
  const withLeads = await harness({
    agent: "simon",
    scopes: ["approvals:propose", "leads:read"],
    kind: "minted",
  }).call("approvals.list", {});
  assert.equal(
    withLeads.data.actions[0].title,
    "Email ana@example.com: pricing",
  );

  const without = await harness({
    agent: "bob",
    scopes: ["approvals:propose"],
    kind: "minted",
  }).call("approvals.list", {});
  assert.equal(without.isError, false);
  assert.equal(without.data.waiting, 1);
  assert.ok(!without.text.includes("ana@example.com"));
  assert.ok(!("title" in without.data.actions[0]));
});

test("pipeline.move needs leads:read as well, so it cannot be used to probe for leads", async () => {
  const { call, fake } = harness({
    agent: "bob",
    scopes: ["approvals:propose"],
    kind: "minted",
  });
  const result = await call("pipeline.move", {
    email: "nobody@example.com",
    stage: "Proposal",
  });
  assert.equal(result.isError, true);
  assert.deepEqual(result.data.missing_scopes, ["leads:read"]);
  assert.deepEqual(fake.writes(), []);
});

test("a second proposal for the same deal comes back as a tool error", async () => {
  const { call } = harness();
  assert.equal(
    (await call("pipeline.move", { opportunity_id: DEAL, close_as: "won" }))
      .isError,
    false,
  );
  const again = await call("pipeline.move", {
    opportunity_id: DEAL,
    stage: "Proposal",
  });
  assert.equal(again.isError, true);
  assert.match(again.data.error, /already waiting/);
});

test("approvals.mine shows only the caller's proposals", async () => {
  const { call } = harness({
    agent: "simon",
    scopes: ["leads:read", "approvals:propose", "content:write"],
    kind: "minted",
  });
  await call("article.propose", {
    title: "Own your home",
    target_keyword: "digital home",
  });
  const mine = await call("approvals.mine", {});
  assert.equal(mine.data.count, 1);
  assert.equal(mine.data.actions[0].payload.kind, "article_topic");
});

test("leads.timeline pages on (created_at, id) with an opaque cursor", async () => {
  const { call, fake } = harness();
  const first = await call("leads.timeline", { lead_id: LEAD, limit: 2 });
  assert.deepEqual(
    first.data.entries.map((e: { title: string }) => e.title),
    ["c", "b"],
  );
  assert.equal(
    first.data.next_cursor,
    "2026-10-25T08:00:00.123456+00:00|aaaaaaaa-0000-4000-8000-000000000002",
  );

  await call("leads.timeline", {
    lead_id: LEAD,
    limit: 2,
    cursor: first.data.next_cursor,
  });
  const filter = fake.ops
    .filter((op) => op.table === "lead_activities")
    .pop()!
    .filters.find((f) => f.startsWith("or("));
  assert.equal(
    filter,
    'or(created_at.lt."2026-10-25T08:00:00.123456+00:00",and(created_at.eq."2026-10-25T08:00:00.123456+00:00",id.lt.aaaaaaaa-0000-4000-8000-000000000002))',
  );

  const bad = await call("leads.timeline", {
    lead_id: LEAD,
    cursor: "2026-10-25T08:00:00Z,id.gt.0|nope-not-a-uuid-at-all-here-1234567",
  });
  assert.equal(bad.isError, true);
});

test("timeline cursors round-trip and refuse anything we did not issue", () => {
  const entry = {
    created_at: "2026-10-25T08:00:00.123456+00:00",
    id: "aaaaaaaa-0000-4000-8000-000000000002",
  };
  assert.deepEqual(parseTimelineCursor(timelineCursor(entry)), {
    createdAt: entry.created_at,
    id: entry.id,
  });
  assert.deepEqual(
    parseTimelineCursor(
      "2026-10-25T08:00:00.123Z|aaaaaaaa-0000-4000-8000-000000000002",
    )?.createdAt,
    "2026-10-25T08:00:00.123Z",
  );
  for (const bad of [
    "",
    "|aaaaaaaa-0000-4000-8000-000000000002",
    "2026-10-25T08:00:00Z|1",
    'x",id.gt.0|aaaaaaaa-0000-4000-8000-000000000002',
    "2026-10-25T08:00:00Z),or(id.gt.0|aaaaaaaa-0000-4000-8000-000000000002",
  ]) {
    assert.equal(parseTimelineCursor(bad), null, bad);
  }
});
