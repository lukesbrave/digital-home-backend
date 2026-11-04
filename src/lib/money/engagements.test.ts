import assert from "node:assert/strict";
import test from "node:test";
import type { MoneyClient } from "./db.ts";
import { createEngagementFromDeal, homeCurrency, onDealWon } from "./engagements.ts";
import { fakeDb } from "./fake-db.ts";

const OPP = "66666666-6666-4666-8666-666666666666";

function setup(extra: Record<string, Array<Record<string, unknown>>> = {}) {
  const db = fakeDb({
    opportunities: [{ id: OPP, lead_id: "lead-1", name: "Acme rebrand", value_cents: 800000, currency: null, status: "won" }],
    leads: [{ id: "lead-1", email: "acme@example.com", tags: [], status: "converted" }],
    ...extra,
  });
  return { db, client: db as unknown as MoneyClient };
}

test("a won deal opens one engagement at brief, in the Home's currency, however often it is won", async () => {
  const { db, client } = setup({ backend_settings: [{ key: "money_currency", value: "nzd" }] });
  const first = await createEngagementFromDeal(client, { opportunityId: OPP, actor: "human" }, async () => []);
  const second = await createEngagementFromDeal(client, { opportunityId: OPP, actor: "agent:operator" });
  assert.equal(first.ok && first.created, true);
  assert.equal(second.ok && second.created, false);
  assert.equal(db.rows("engagements").length, 1);
  const e = db.rows("engagements")[0];
  assert.equal(e.stage, "brief");
  assert.equal(e.value_minor, 800000);
  assert.equal(e.currency, "NZD");
  assert.equal(db.rows("lead_activities").filter((a) => a.activity_type === "engagement_opened").length, 1);
});

test("the currency falls back to AUD when the Home names none", async () => {
  const { client } = setup();
  assert.equal(await homeCurrency(client), "AUD");
});

test("onDealWon never throws: a failure is logged on the lead's timeline", async () => {
  const { db, client } = setup();
  db.failWhen = (table, op) => table === "engagements" && op === "insert";
  const errors: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void errors.push(args);
  try {
    const result = await onDealWon(client, { opportunityId: OPP, leadId: "lead-1", actor: "agent:operator" });
    assert.equal(result.ok, false);
  } finally {
    console.error = original;
  }
  assert.equal(errors.length, 1);
  const note = db.rows("lead_activities").find((a) => a.activity_type === "engagement_failed");
  assert.match(String(note?.title), /could not be opened/);
});

test("an unknown deal is a 404, not an engagement", async () => {
  const { db, client } = setup();
  const result = await createEngagementFromDeal(client, { opportunityId: "77777777-7777-4777-8777-777777777777" });
  assert.deepEqual(result, { ok: false, status: 404, error: "Opportunity not found" });
  assert.equal(db.rows("engagements").length, 0);
});
