import assert from "node:assert/strict";
import test from "node:test";
import type { AdminClient } from "../crm/types.ts";
import { FakeSupabase } from "../testing/fake-supabase.ts";
import { Marked } from "marked";
import { isDecisionAction } from "./decision-kinds.ts";
import { renderSafeMarkdown } from "./safe-markdown.ts";
import {
  executeAgentProposal,
  proposeArticle,
  proposePipelineMove,
  proposeSocialDraft,
  type ProposalExecDeps,
} from "./proposals.ts";

const LEAD = "11111111-1111-4111-8111-111111111111";
const DEAL = "22222222-2222-4222-8222-222222222222";
const STAGE_A = "33333333-3333-4333-8333-333333333331";
const STAGE_B = "33333333-3333-4333-8333-333333333332";
const PIPE = "44444444-4444-4444-8444-444444444444";

function home() {
  const fake = new FakeSupabase(
    {
      leads: [
        {
          id: LEAD,
          email: "ana@example.com",
          first_name: "Ana",
          last_name: null,
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
        { id: STAGE_B, name: "Proposal", pipeline_id: PIPE, position: 2 },
      ],
      agent_actions: [],
      content_calendar: [],
      social_posts: [],
    },
    {
      defaults: { agent_actions: { status: "proposed" } },
      unique: { content_calendar: [["search_query", "target_keyword"]] },
    },
  );
  return { fake, db: fake as unknown as AdminClient };
}

function recordingDeps() {
  const log: { activities: unknown[]; triggers: unknown[]; drafts: unknown[] } =
    { activities: [], triggers: [], drafts: [] };
  const deps: ProposalExecDeps = {
    logActivity: async (_supabase, input) => {
      log.activities.push(input);
    },
    fireTrigger: async (_supabase, event) => {
      log.triggers.push(event);
      return [];
    },
    createSocialDraft: async (input) => {
      log.drafts.push(input);
      return { data: { post_id: "post-1", post_type: "video" } };
    },
  };
  return { deps, log };
}

const SIMON = { agent: "simon", runId: "run-1" };

test("filing a deal move queues a decision and touches nothing else", async () => {
  const { fake, db } = home();
  const filed = await proposePipelineMove(
    db,
    {
      email: "ana@example.com",
      stage: "proposal",
      reason: "She asked for pricing",
    },
    SIMON,
  );
  assert.equal(filed.status, "proposed");
  assert.equal(filed.title, 'Move "Ana: coaching" to Proposal');

  assert.deepEqual(
    fake.writes().map((w) => `${w.op} ${w.table}`),
    ["insert agent_actions"],
  );
  const row = fake.tables.agent_actions[0];
  assert.equal(row.type, "other");
  assert.equal(row.run_id, "run-1");
  const payload = row.payload as Record<string, unknown>;
  assert.equal(payload.kind, "pipeline_move");
  assert.equal(payload.proposed_by, "simon");
  assert.equal(payload.from_stage_id, STAGE_A);
  assert.equal(payload.to_stage_id, STAGE_B);
  assert.ok(
    isDecisionAction({ type: "other", payload }),
    "a deal move must render as Approve/Reject",
  );
  assert.equal(fake.tables.opportunities[0].stage_id, STAGE_A);
});

test("a second proposal for the same deal is refused while one waits", async () => {
  const { fake, db } = home();
  await proposePipelineMove(
    db,
    { opportunity_id: DEAL, stage: "Proposal" },
    SIMON,
  );
  await assert.rejects(
    proposePipelineMove(
      db,
      { opportunity_id: DEAL, close_as: "won" },
      { agent: "bob", runId: null },
    ),
    /already waiting/,
  );
  assert.equal(fake.tables.agent_actions.length, 1);
});

test("filing refuses unknown stages, a move to the current stage, and stage plus close_as", async () => {
  const { db } = home();
  await assert.rejects(
    proposePipelineMove(db, { opportunity_id: DEAL, stage: "Nope" }, SIMON),
    /No stage named "Nope"/,
  );
  await assert.rejects(
    proposePipelineMove(
      db,
      { opportunity_id: DEAL, stage: "Discovery" },
      SIMON,
    ),
    /already in Discovery/,
  );
  await assert.rejects(
    proposePipelineMove(
      db,
      { opportunity_id: DEAL, stage: "Proposal", close_as: "won" },
      SIMON,
    ),
    /not both/,
  );
});

test("approving a deal move moves it, as the proposing agent, and fires the stage trigger", async () => {
  const { fake, db } = home();
  await proposePipelineMove(
    db,
    { opportunity_id: DEAL, stage: "Proposal" },
    SIMON,
  );
  const action = fake.tables.agent_actions[0] as {
    id: string;
    payload: unknown;
  };
  const { deps, log } = recordingDeps();

  const result = await executeAgentProposal(db, action, deps);
  assert.deepEqual(result, { opportunity_id: DEAL, stage: "Proposal" });
  assert.equal(fake.tables.opportunities[0].stage_id, STAGE_B);
  assert.equal((log.activities[0] as { actor: string }).actor, "agent:simon");
  assert.equal((log.triggers[0] as { type: string }).type, "stage_changed");
});

test("approving a close as won closes the deal and logs the agent", async () => {
  const { fake, db } = home();
  await proposePipelineMove(
    db,
    { opportunity_id: DEAL, close_as: "won" },
    SIMON,
  );
  const { deps, log } = recordingDeps();
  const result = await executeAgentProposal(
    db,
    fake.tables.agent_actions[0] as { id: string; payload: unknown },
    deps,
  );
  assert.deepEqual(result, { opportunity_id: DEAL, status: "won" });
  assert.equal(fake.tables.opportunities[0].status, "won");
  assert.equal((log.activities[0] as { actor: string }).actor, "agent:simon");
  assert.equal(log.triggers.length, 0);
});

test("approval refuses a deal that moved or closed since it was proposed, and changes nothing", async () => {
  const { fake, db } = home();
  await proposePipelineMove(
    db,
    { opportunity_id: DEAL, close_as: "lost", lost_reason: "budget" },
    SIMON,
  );
  const action = fake.tables.agent_actions[0] as {
    id: string;
    payload: unknown;
  };
  const { deps, log } = recordingDeps();

  fake.tables.opportunities[0].stage_id = STAGE_B; // the owner moved it meanwhile
  const writesBefore = fake.writes().length;
  await assert.rejects(
    executeAgentProposal(db, action, deps),
    /moved after this was proposed/,
  );
  assert.equal(fake.writes().length, writesBefore);
  assert.equal(fake.tables.opportunities[0].status, "open");

  fake.tables.opportunities[0].stage_id = STAGE_A;
  fake.tables.opportunities[0].status = "won";
  await assert.rejects(
    executeAgentProposal(db, action, deps),
    /was closed as won/,
  );
  assert.equal(log.activities.length, 0);
});

test("an article proposal queues a decision; approval files it as approved", async () => {
  const { fake, db } = home();
  const filed = await proposeArticle(
    db,
    { title: "Own your home", target_keyword: "Digital Home", notes: "angle" },
    SIMON,
  );
  assert.equal(filed.title, "Article: Own your home");
  assert.equal(
    fake.tables.content_calendar.length,
    0,
    "nothing on the calendar until approved",
  );
  await assert.rejects(
    proposeArticle(
      db,
      { title: "Again", target_keyword: "digital home" },
      SIMON,
    ),
    /already waiting/,
  );

  const result = await executeAgentProposal(
    db,
    fake.tables.agent_actions[0] as { id: string; payload: unknown },
    recordingDeps().deps,
  );
  assert.equal((result as { status: string }).status, "approved");
  assert.equal(fake.tables.content_calendar[0].status, "approved");
  assert.match(
    String(fake.tables.content_calendar[0].notes),
    /Proposed by simon over MCP, approved by the owner/,
  );

  // Already on the calendar now (decideAgentAction marks the row executed): a fresh proposal is refused up front.
  fake.tables.agent_actions[0].status = "executed";
  await assert.rejects(
    proposeArticle(
      db,
      { title: "Third", target_keyword: "Digital Home" },
      SIMON,
    ),
    /already on the calendar/,
  );
});

test("approving an article whose keyword landed meanwhile is refused cleanly", async () => {
  const { fake, db } = home();
  await proposeArticle(
    db,
    { title: "Own your home", target_keyword: "digital home" },
    SIMON,
  );
  fake.tables.content_calendar.push({
    id: "c1",
    title: "x",
    status: "planned",
    search_query: "digital home",
    target_keyword: "digital home",
  });
  await assert.rejects(
    executeAgentProposal(
      db,
      fake.tables.agent_actions[0] as { id: string; payload: unknown },
      recordingDeps().deps,
    ),
    /already on the calendar/,
  );
});

test("a social proposal queues a decision; approval saves a draft signed by the agent", async () => {
  const { fake, db } = home();
  fake.tables.social_posts.push({ id: "post-1", created_by: "agent:operator" });
  await proposeSocialDraft(
    db,
    { caption: "Your home, your rules", platforms: ["instagram"] },
    SIMON,
  );
  assert.equal(fake.tables.social_posts.length, 1, "no draft until approved");
  await assert.rejects(
    proposeSocialDraft(db, { caption: "Your home, your rules" }, SIMON),
    /already waiting/,
  );

  const { deps, log } = recordingDeps();
  await executeAgentProposal(
    db,
    fake.tables.agent_actions[0] as { id: string; payload: unknown },
    deps,
  );
  assert.deepEqual(log.drafts, [
    {
      caption: "Your home, your rules",
      title: undefined,
      media_urls: undefined,
      platforms: ["instagram"],
    },
  ]);
  assert.equal(fake.tables.social_posts[0].created_by, "agent:simon");
});

test("rows that are not agent proposals are left to the caller", async () => {
  const { db } = home();
  assert.equal(
    await executeAgentProposal(
      db,
      { id: "x", payload: { alert_kind: "hot_lead" } },
      recordingDeps().deps,
    ),
    null,
  );
});

test("isDecisionAction: executes-on-approve rows are decisions, notices are FYIs", () => {
  assert.equal(isDecisionAction({ type: "email", payload: {} }), true);
  assert.equal(
    isDecisionAction({
      type: "other",
      payload: { alert_kind: "possible_conversion" },
    }),
    true,
  );
  for (const kind of ["pipeline_move", "article_topic", "social_draft"]) {
    assert.equal(
      isDecisionAction({ type: "other", payload: { kind } }),
      true,
      kind,
    );
  }
  assert.equal(
    isDecisionAction({ type: "other", payload: { alert_kind: "hot_lead" } }),
    false,
  );
  assert.equal(
    isDecisionAction({ type: "other", payload: { kind: "toString" } }),
    false,
  );
  assert.equal(isDecisionAction({ type: "other", payload: null }), false);
});

const HOSTILE =
  'Launch day <img src=x onerror="alert(1)"> [see more](javascript:alert(document.cookie)) <script>alert(2)</script>';

/** Live markup an attacker would need: an element other than marked's plain text tags, or any link or image. */
function assertNoLiveMarkup(html: string, label: string) {
  assert.doesNotMatch(
    html,
    /<(img|script|a|svg|iframe)\b/i,
    `${label}: ${html}`,
  );
  assert.doesNotMatch(html, /<[^>]+\son[a-z]+\s*=/i, `${label}: ${html}`);
  assert.doesNotMatch(html, /<[^>]*\s(href|src)\s*=/i, `${label}: ${html}`);
}

test("agent text in proposal descriptions renders inert, through the safe renderer and even through plain marked", async () => {
  const { fake, db } = home();
  const plain = new Marked({ gfm: true, breaks: true });
  await proposeSocialDraft(
    db,
    { caption: HOSTILE, title: HOSTILE, reason: HOSTILE },
    SIMON,
  );
  await proposeArticle(
    db,
    {
      title: HOSTILE,
      target_keyword: "launch <b>day</b>",
      notes: HOSTILE,
      pillar_topic: HOSTILE,
      reason: HOSTILE,
    },
    SIMON,
  );
  await proposePipelineMove(
    db,
    {
      opportunity_id: DEAL,
      close_as: "lost",
      lost_reason: HOSTILE,
      reason: HOSTILE,
    },
    SIMON,
  );

  assert.equal(fake.tables.agent_actions.length, 3);
  for (const row of fake.tables.agent_actions) {
    const description = (row.payload as { description: string }).description;
    assertNoLiveMarkup(renderSafeMarkdown(description), `safe ${row.title}`);
    assertNoLiveMarkup(
      plain.parse(description, { async: false }) as string,
      `plain ${row.title}`,
    );
    assert.match(
      renderSafeMarkdown(description),
      /onerror/,
      "the text itself is still shown to the owner",
    );
  }
});

test("the article duplicate check ignores case, at filing and at approval", async () => {
  const { fake, db } = home();
  fake.tables.content_calendar.push({
    id: "c1",
    title: "Existing",
    status: "planned",
    search_query: "Digital Home",
    target_keyword: "Digital Home",
  });
  await assert.rejects(
    proposeArticle(db, { title: "New", target_keyword: "digital HOME" }, SIMON),
    /already on the calendar: Existing/,
  );
  // Wildcards in a keyword are literal, not patterns.
  await proposeArticle(
    db,
    { title: "Pct", target_keyword: "100% owned" },
    SIMON,
  );
  await proposeArticle(
    db,
    { title: "Under", target_keyword: "Digital_Home" },
    SIMON,
  );
  assert.equal(fake.tables.agent_actions.length, 2);

  const filed = fake.tables.agent_actions[0] as {
    id: string;
    payload: unknown;
  };
  fake.tables.content_calendar.push({
    id: "c2",
    title: "Raced in",
    status: "planned",
    search_query: "x",
    target_keyword: "100% OWNED",
  });
  await assert.rejects(
    executeAgentProposal(db, filed, recordingDeps().deps),
    /already on the calendar: Raced in/,
  );
});
