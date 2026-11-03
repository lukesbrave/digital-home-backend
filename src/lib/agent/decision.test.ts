import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeSupabase } from "../testing/fake-supabase.ts";
import type { AdminClient } from "../crm/types.ts";
import { decideAction } from "./decision.ts";
const actor = { actor_type: "human" as const, actor: "owner" };
function fixture() {
  const fake = new FakeSupabase({
    agent_actions: [
      { id: "one", status: "proposed", type: "other", payload: {} },
    ],
  });
  return { fake, db: fake as unknown as AdminClient };
}
test("concurrent approvals claim a proposal only once", async () => {
  const { db } = fixture();
  let executed = 0;
  const run = () =>
    decideAction(
      db,
      "one",
      "approve",
      actor,
      async () => {
        executed++;
        await new Promise((r) => setTimeout(r, 5));
        return { ok: true };
      },
      async () => {},
    );
  const outcomes = await Promise.allSettled([run(), run()]);
  assert.equal(executed, 1);
  assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((o) => o.status === "rejected").length, 1);
});
test("rejection never executes, and a later approval is refused", async () => {
  const { db } = fixture();
  let executed = 0;
  const execute = async () => {
    executed++;
    return {};
  };
  await decideAction(db, "one", "reject", actor, execute, async () => {});
  await assert.rejects(
    decideAction(db, "one", "approve", actor, execute, async () => {}),
    /already rejected/,
  );
  assert.equal(executed, 0);
});
test("execution failure is terminal and is not silently retried", async () => {
  const { db } = fixture();
  let executed = 0;
  const execute = async () => {
    executed++;
    throw new Error("destination unavailable");
  };
  await assert.rejects(
    decideAction(db, "one", "approve", actor, execute, async () => {}),
    /destination unavailable/,
  );
  await assert.rejects(
    decideAction(db, "one", "approve", actor, execute, async () => {}),
    /already failed/,
  );
  assert.equal(executed, 1);
});
