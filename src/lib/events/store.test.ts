/**
 * recordHomeEvent, scrubHomeEventsForLead and readHomeEvents against fake
 * Supabase clients, plus the migration's trigger text. No database.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readHomeEvents } from "./feed.ts";
import { recordHomeEvent, scrubHomeEventsForLead } from "./record.ts";
import {
  approvalEvent,
  articlePublishedEvent,
  decodeCursor,
  encodeCursor,
  FEED_SETTLE_MS,
  leadUpsertEvent,
  TELEGRAM_OWNER,
  type FeedQuery,
  type HomeEventInput,
} from "./shape.ts";

const LEAD = "6f1c2b9e-4a3d-4e8f-9b21-0c5d7e8f9a10";
const OTHER_LEAD = "7a2d3c0f-5b4e-4f90-8c32-1d6e8f9a0b21";
const ACTION_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NOW = new Date("2026-10-27T12:00:00.000Z");

// Keep the suite's output clean: recordHomeEvent warns on every failure.
console.warn = () => {};

// ── recordHomeEvent ─────────────────────────────────────────────────────────

type InsertBehaviour = "ok" | "error" | "throws" | "rejects" | "no-row";

function fakeInsertClient(behaviour: InsertBehaviour) {
  const inserted: Record<string, unknown>[] = [];
  const client = {
    from(table: string) {
      assert.equal(table, "home_events");
      if (behaviour === "throws") throw new Error("socket hang up");
      return {
        insert(row: Record<string, unknown>) {
          inserted.push(row);
          return {
            select() {
              return {
                async single() {
                  if (behaviour === "rejects") throw new Error("fetch failed");
                  if (behaviour === "error") return { data: null, error: { message: "relation \"home_events\" does not exist" } };
                  if (behaviour === "no-row") return { data: null, error: null };
                  return { data: { id: "row-1", seq: "42" }, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
  return { client: client as never, inserted };
}

test("recordHomeEvent inserts a validated row and returns its seq", async () => {
  const { client, inserted } = fakeInsertClient("ok");
  const result = await recordHomeEvent(client, leadUpsertEvent({ actor_type: "human", actor: "user-1" }, LEAD, true, 1));
  assert.deepEqual(result, { ok: true, id: "row-1", seq: 42 });
  assert.deepEqual(inserted, [{
    actor_type: "human", actor: "user-1", action: "lead.captured",
    subject_type: "lead", subject_id: LEAD, lead_id: LEAD, payload: { added_tag_count: 1 }, evidence: {},
  }]);
});

test("recordHomeEvent never throws: every failure is {ok: false, error}", async () => {
  const event = leadUpsertEvent({ actor_type: "system", actor: "system" }, LEAD, false, 0);
  for (const behaviour of ["error", "throws", "rejects", "no-row"] as const) {
    const { client } = fakeInsertClient(behaviour);
    const result = await recordHomeEvent(client, event);
    assert.equal(result.ok, false, behaviour);
    if (!result.ok) assert.ok(result.error.length > 0, behaviour);
  }
  const { client, inserted } = fakeInsertClient("ok");
  const refused = await recordHomeEvent(client, { ...event, action: "lead.deleted" } as unknown as HomeEventInput);
  assert.equal(refused.ok, false);
  assert.equal(inserted.length, 0, "a refused event is never inserted");
  assert.equal((await recordHomeEvent(client, null as unknown as HomeEventInput)).ok, false);
});

// ── One emit point each, through the client ─────────────────────────────────

test("emit points: created vs updated leads, and the decider on approvals", async () => {
  const { client, inserted } = fakeInsertClient("ok");
  await recordHomeEvent(client, leadUpsertEvent({ actor_type: "webhook", actor: "capture:funnel-secret" }, LEAD, true, 0));
  await recordHomeEvent(client, leadUpsertEvent({ actor_type: "system", actor: "skool-pull" }, LEAD, false, 2));
  const proposal = { id: ACTION_ID, type: "publish", title: "Post: Ana's win", payload: { kind: "social_post" } };
  await recordHomeEvent(client, approvalEvent(proposal, "approval.granted", TELEGRAM_OWNER));
  await recordHomeEvent(client, approvalEvent(proposal, "approval.executed", { actor_type: "human", actor: "user-1" }, { scheduled: true }));
  await recordHomeEvent(client, articlePublishedEvent({ actor_type: "system", actor: "approvals" }, { id: ACTION_ID, slug: "a-post", agentActionId: ACTION_ID }));

  assert.deepEqual(inserted.map((r) => [r.action, r.actor_type, r.actor]), [
    ["lead.captured", "webhook", "capture:funnel-secret"],
    ["lead.updated", "system", "skool-pull"],
    ["approval.granted", "human", "telegram"],
    ["approval.executed", "human", "user-1"],
    ["article.published", "system", "approvals"],
  ]);
  assert.deepEqual(inserted[3].payload, { type: "publish", kind: "social_post", outcome: "scheduled" });
  for (const row of inserted) assert.ok(!JSON.stringify(row).includes("Ana"), `${row.action} leaked a title`);
});

// ── scrubHomeEventsForLead ──────────────────────────────────────────────────

test("scrubHomeEventsForLead calls the erasure function and never throws", async () => {
  const calls: [string, unknown][] = [];
  const ok = { rpc: async (fn: string, args: unknown) => (calls.push([fn, args]), { data: 3, error: null }) };
  assert.deepEqual(await scrubHomeEventsForLead(ok as never, LEAD), { ok: true, deleted: 3 });
  assert.deepEqual(calls, [["scrub_home_events_for_lead", { p_lead_id: LEAD }]]);

  const failing = { rpc: async () => ({ data: null, error: { message: "function does not exist" } }) };
  assert.deepEqual(await scrubHomeEventsForLead(failing as never, LEAD), { ok: false, error: "function does not exist" });
  const throwing = { rpc: async () => { throw new Error("offline"); } };
  assert.deepEqual(await scrubHomeEventsForLead(throwing as never, LEAD), { ok: false, error: "offline" });
  assert.equal((await scrubHomeEventsForLead(ok as never, "not-a-uuid")).ok, false);
  assert.equal(calls.length, 1, "a bad id never reaches the database");
});

// ── readHomeEvents ──────────────────────────────────────────────────────────

interface FakeRow {
  id: string;
  seq: number;
  occurred_at: string;
  actor_type: string;
  actor: string;
  action: string;
  subject_type: string | null;
  subject_id: string | null;
  lead_id: string | null;
  payload: unknown;
  evidence: unknown;
}

function row(seq: number, action: string, secondsAgo: number, extra: Partial<FakeRow> = {}): FakeRow {
  return {
    id: `id-${seq}`, seq, occurred_at: new Date(NOW.getTime() - secondsAgo * 1000).toISOString(),
    actor_type: "system", actor: "system", action, subject_type: null, subject_id: null, lead_id: LEAD,
    payload: {}, evidence: {}, ...extra,
  };
}

/** A query builder that applies the filters the feed uses, like PostgREST would. */
function fakeFeedClient(rows: FakeRow[]) {
  const calls: string[] = [];
  const client = {
    from(table: string) {
      assert.equal(table, "home_events");
      let result = [...rows];
      let limit = Infinity;
      const builder = {
        select() { return builder; },
        gt(col: "seq", value: number) { calls.push(`gt ${col}`); result = result.filter((r) => r[col] > value); return builder; },
        lt(col: "occurred_at", value: string) { calls.push(`lt ${col}`); result = result.filter((r) => r[col] < value); return builder; },
        eq(col: "action" | "lead_id", value: string) { calls.push(`eq ${col}`); result = result.filter((r) => r[col] === value); return builder; },
        like(col: "action", pattern: string) {
          calls.push(`like ${col}`);
          const prefix = pattern.replace(/%$/, "");
          result = result.filter((r) => r[col].startsWith(prefix));
          return builder;
        },
        order() { result.sort((a, b) => a.seq - b.seq); return builder; },
        limit(n: number) { limit = n; return builder; },
        then(resolve: (value: { data: FakeRow[]; error: null }) => void) {
          resolve({ data: result.slice(0, limit), error: null });
        },
      };
      return builder;
    },
  };
  return { client: client as never, calls };
}

const query = (q: Partial<FeedQuery> = {}): FeedQuery => ({ afterSeq: 0, limit: 100, actionPrefix: null, leadId: null, ...q });

test("readHomeEvents pages in seq order with has_more and next_cursor", async () => {
  const rows = [row(3, "lead.updated", 60), row(1, "lead.captured", 90), row(2, "deal.moved", 80), row(4, "email.sent", 30)];
  const { client } = fakeFeedClient(rows);

  const first = await readHomeEvents(client, query({ limit: 2 }), NOW);
  assert.deepEqual(first.events.map((e) => e.seq), [1, 2]);
  assert.equal(first.has_more, true);
  assert.equal(decodeCursor(first.next_cursor), 2);
  assert.equal(decodeCursor(first.events[0].cursor), 1);

  const second = await readHomeEvents(client, query({ afterSeq: 2, limit: 2 }), NOW);
  assert.deepEqual(second.events.map((e) => e.seq), [3, 4]);
  assert.equal(second.has_more, false);
  assert.equal(decodeCursor(second.next_cursor), 4);

  const empty = await readHomeEvents(client, query({ afterSeq: 4 }), NOW);
  assert.deepEqual(empty.events, []);
  assert.equal(empty.has_more, false);
  assert.equal(empty.next_cursor, encodeCursor(4), "nothing new keeps the cursor where it was");
});

test("readHomeEvents holds back events younger than the settle lag", async () => {
  const settle = FEED_SETTLE_MS / 1000;
  const rows = [
    row(1, "lead.captured", settle + 1),
    row(2, "lead.updated", settle + 0.001),
    row(3, "deal.moved", settle), // exactly at the boundary: not settled yet
    row(4, "email.sent", 0),
  ];
  const { client, calls } = fakeFeedClient(rows);
  const page = await readHomeEvents(client, query(), NOW);
  assert.deepEqual(page.events.map((e) => e.seq), [1, 2]);
  assert.equal(page.settled_before, new Date(NOW.getTime() - FEED_SETTLE_MS).toISOString());
  assert.equal(decodeCursor(page.next_cursor), 2, "the cursor stops before unsettled rows");
  assert.ok(calls.includes("lt occurred_at"));

});

test("a lower seq that commits after a higher one is not stepped past", async () => {
  // seq 2 was inserted before seq 3 but has not committed yet, so the first
  // poll cannot see it; seq 3 is visible but still inside the settle lag.
  const settle = FEED_SETTLE_MS / 1000;
  const seq1 = row(1, "lead.captured", 60);
  const seq2 = row(2, "lead.updated", settle - 1);
  const seq3 = row(3, "deal.moved", settle - 1.5);
  const first = await readHomeEvents(fakeFeedClient([seq1, seq3]).client, query(), NOW);
  assert.deepEqual(first.events.map((e) => e.seq), [1]);
  assert.equal(decodeCursor(first.next_cursor), 1, "the cursor has not stepped past seq 2");

  // Seconds later seq 2 has committed and both have settled.
  const later = new Date(NOW.getTime() + FEED_SETTLE_MS);
  const second = await readHomeEvents(fakeFeedClient([seq1, seq2, seq3]).client, query({ afterSeq: 1 }), later);
  assert.deepEqual(second.events.map((e) => e.seq), [2, 3]);
});

test("readHomeEvents redacts on the way out", async () => {
  const leaky = row(1, "lead.updated", 60, {
    payload: { added_tag_count: 1, refresh_token: "t", nested: { password: "p", ok: true } },
    evidence: { buzz_event_id: "evt_1", stripe_webhook_secret: "s", note: `bbk_simon_${"a".repeat(32)}` },
  });
  const { client } = fakeFeedClient([leaky]);
  const [event] = (await readHomeEvents(client, query(), NOW)).events;
  assert.deepEqual(event.payload, { added_tag_count: 1, nested: { ok: true } });
  assert.deepEqual(event.evidence, { buzz_event_id: "evt_1", note: "[redacted]" });
});

test("readHomeEvents filters: exact actions use eq, prefixes use like, and lead_id narrows", async () => {
  const rows = [
    row(1, "approval.proposed", 60),
    row(2, "approval.granted", 60),
    row(3, "approval.granted", 60, { lead_id: OTHER_LEAD }),
    row(4, "lead.captured", 60),
  ];
  const exact = fakeFeedClient(rows);
  const granted = await readHomeEvents(exact.client, query({ actionPrefix: "approval.granted" }), NOW);
  assert.deepEqual(granted.events.map((e) => e.seq), [2, 3]);
  assert.ok(exact.calls.includes("eq action") && !exact.calls.includes("like action"));

  const prefix = fakeFeedClient(rows);
  const approvals = await readHomeEvents(prefix.client, query({ actionPrefix: "approval." }), NOW);
  assert.deepEqual(approvals.events.map((e) => e.seq), [1, 2, 3]);
  assert.ok(prefix.calls.includes("like action") && !prefix.calls.includes("eq action"));

  const oneLead = fakeFeedClient(rows);
  const other = await readHomeEvents(oneLead.client, query({ leadId: OTHER_LEAD }), NOW);
  assert.deepEqual(other.events.map((e) => e.seq), [3]);
  assert.ok(oneLead.calls.includes("eq lead_id"));
});

// ── The migration ───────────────────────────────────────────────────────────

const migration = readFileSync(
  new URL("../../../supabase/migrations/005_home_events.sql", import.meta.url),
  "utf8"
);

test("events install independently of an optional approvals table", () => {
  assert.ok(!migration.includes("on public.agent_actions"));
});

test("the migration grants nothing beyond the service role and adds the scrub path", () => {
  assert.match(migration, /alter table public\.home_events enable row level security;/);
  assert.match(migration, /revoke all on public\.home_events from anon, authenticated;/);
  assert.match(migration, /create or replace function public\.scrub_home_events_for_lead\(p_lead_id uuid\)/);
  assert.match(migration, /e\.lead_id = p_lead_id\s+or \(e\.subject_type = 'lead' and e\.subject_id = p_lead_id::text\)/);
  for (const fn of ["home_event_counts(timestamptz)", "scrub_home_events_for_lead(uuid)"]) {
    assert.ok(migration.includes(`revoke all on function public.${fn} from public, anon, authenticated;`), fn);
  }
  assert.ok(!/never misses/i.test(migration), "the seq comment must not promise more than the settle lag gives");
});

// ── Wiring the tests cannot load (they import the Next runtime) ─────────────

function source(path: string): string {
  return readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
}

test("PATCH /api/articles/[slug] records article.published only on the transition", () => {
  const route = source("src/app/api/articles/[slug]/route.ts");
  assert.match(route, /\.from\("content_objects"\)\.select\("status"\)\.eq\("slug", slug\)/);
  assert.match(route, /if \(contentFields\.status === "published" && before\?\.status !== "published"\) await recordHomeEvent\(/);
});

test("DELETE /api/crm/leads/[id] reports the scrub as a boolean, never the database error", () => {
  const route = source("src/app/api/crm/leads/[id]/route.ts");
  assert.match(route, /home_events_scrubbed: scrub\.ok \}/);
  assert.ok(!/scrub\.error/.test(route), "the raw error stays server-side");
});
