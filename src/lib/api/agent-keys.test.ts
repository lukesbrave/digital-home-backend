import assert from "node:assert/strict";
import test from "node:test";
import { hashKey, newKeyPlaintext } from "./agent-key-scopes.ts";
import { AgentKeyError, listAgentKeys, mintAgentKey, revokeAgentKey, verifyAgentKey } from "./agent-keys.ts";

type Row = Record<string, unknown>;

/**
 * Just enough of the Supabase query builder for agent_keys: filters, insert,
 * update, select, single/maybeSingle, and awaiting the builder itself.
 */
function fakeDb(rows: Row[] = []) {
  const calls: { op: string; filters: string[]; columns: string[] }[] = [];
  function builder() {
    const filters: ((r: Row) => boolean)[] = [];
    const described: string[] = [];
    const columns: string[] = [];
    let op: "select" | "insert" | "update" = "select";
    let payload: Row = {};
    const run = () => {
      calls.push({ op, filters: described, columns });
      if (op === "insert") {
        if (rows.some((r) => r.name === payload.name && !r.revoked_at)) {
          return { data: null, error: { code: "23505" } };
        }
        const row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), last_used_at: null, revoked_at: null, ...payload };
        rows.push(row);
        return { data: [row], error: null };
      }
      const hits = rows.filter((r) => filters.every((f) => f(r)));
      if (op === "update") hits.forEach((r) => Object.assign(r, payload));
      return { data: hits, error: null };
    };
    const b = {
      select: (cols?: string) => (columns.push(cols || "*"), b),
      insert: (p: Row) => ((op = "insert"), (payload = p), b),
      update: (p: Row) => ((op = "update"), (payload = p), b),
      eq: (col: string, v: unknown) => (filters.push((r) => r[col] === v), described.push(`eq:${col}`), b),
      is: (col: string, v: unknown) => (filters.push((r) => (r[col] ?? null) === v), described.push(`is:${col}`), b),
      or: (expr: string) => {
        const cutoff = expr.split("lt.")[1];
        filters.push((r) => !r.last_used_at || String(r.last_used_at) < cutoff);
        described.push("or:last_used_at");
        return b;
      },
      order: () => b,
      single: async () => {
        const { data, error } = run();
        return { data: data?.[0] ?? null, error };
      },
      maybeSingle: async () => {
        const { data, error } = run();
        return { data: data?.[0] ?? null, error };
      },
      then: (resolve: (v: unknown) => unknown) => resolve(run()),
    };
    return b;
  }
  const db = { from: () => builder() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { db: db as any, rows, calls };
}

test("mint returns the plaintext once and stores only its hash", async () => {
  const { db, rows } = fakeDb();
  const key = await mintAgentKey(db, { name: "simon", scopes: "leads:read,events:read", createdBy: "master", note: " hire " });
  assert.match(key.plaintext, /^bbk_simon_[0-9a-f]{32}$/);
  assert.deepEqual(key.scopes, ["leads:read", "events:read"]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key_hash, hashKey(key.plaintext));
  assert.equal(rows[0].key_prefix, key.plaintext.slice(0, "bbk_simon_".length + 4));
  assert.equal(rows[0].note, "hire");
  assert.equal(Object.values(rows[0]).includes(key.plaintext), false);
});

test("mint refuses bad names, reserved names, bad scopes, and a second active key per name", async () => {
  const { db } = fakeDb();
  await assert.rejects(mintAgentKey(db, { name: "Simon", scopes: ["leads:read"], createdBy: "master" }), AgentKeyError);
  await assert.rejects(mintAgentKey(db, { name: "master", scopes: ["leads:read"], createdBy: "master" }), /reserved/);
  await assert.rejects(mintAgentKey(db, { name: "content_agent", scopes: ["leads:read"], createdBy: "master" }), /reserved/);
  await assert.rejects(mintAgentKey(db, { name: "simon", scopes: ["*"], createdBy: "master" }), /cannot hold/);
  await mintAgentKey(db, { name: "simon", scopes: ["leads:read"], createdBy: "master" });
  await assert.rejects(
    mintAgentKey(db, { name: "simon", scopes: ["leads:read"], createdBy: "master" }),
    (e: unknown) => e instanceof AgentKeyError && e.status === 409
  );
});

test("verify finds a live key by hash, and refuses unknown, malformed and revoked keys", async () => {
  const { db } = fakeDb();
  const { plaintext } = await mintAgentKey(db, { name: "simon", scopes: ["events:read"], createdBy: "master" });
  assert.deepEqual(await verifyAgentKey(db, plaintext), { name: "simon", scopes: ["events:read"] });
  assert.equal(await verifyAgentKey(db, newKeyPlaintext("simon")), null);
  assert.equal(await verifyAgentKey(db, "not-a-minted-key"), null);

  await revokeAgentKey(db, { name: "simon" });
  assert.equal(await verifyAgentKey(db, plaintext), null);
});

test("verify touches last_used_at once, then not again within ten minutes", async () => {
  const { db, rows, calls } = fakeDb();
  const { plaintext } = await mintAgentKey(db, { name: "simon", scopes: ["events:read"], createdBy: "master" });
  await verifyAgentKey(db, plaintext);
  const firstUse = rows[0].last_used_at;
  assert.ok(firstUse);
  const updatesAfterFirst = calls.filter((c) => c.op === "update").length;
  await verifyAgentKey(db, plaintext);
  assert.equal(calls.filter((c) => c.op === "update").length, updatesAfterFirst);
  assert.equal(rows[0].last_used_at, firstUse);

  const stale = new Date(Date.now() - 11 * 60_000).toISOString();
  rows[0].last_used_at = stale;
  await verifyAgentKey(db, plaintext);
  assert.notEqual(rows[0].last_used_at, stale);
  assert.ok(Date.now() - Date.parse(String(rows[0].last_used_at)) < 5_000);
});

test("verify drops a * slipped into the database by hand", async () => {
  const { db, rows } = fakeDb();
  const { plaintext } = await mintAgentKey(db, { name: "simon", scopes: ["events:read"], createdBy: "master" });
  rows[0].scopes = ["*", "events:read"];
  assert.deepEqual((await verifyAgentKey(db, plaintext))?.scopes, ["events:read"]);
});

test("revoke frees the name for a new key and keeps the old row", async () => {
  const { db } = fakeDb();
  await mintAgentKey(db, { name: "simon", scopes: ["events:read"], createdBy: "master" });
  assert.equal((await revokeAgentKey(db, { name: "simon" }))?.name, "simon");
  assert.equal(await revokeAgentKey(db, { name: "simon" }), null);
  await mintAgentKey(db, { name: "simon", scopes: ["leads:read"], createdBy: "master" });
  await assert.rejects(revokeAgentKey(db, { id: "nope" }), /not a key id/);
  await assert.rejects(revokeAgentKey(db, {}), /Pass/);
  assert.equal((await listAgentKeys(db)).length, 2);
});

test("list names its columns, and key_hash is not one of them", async () => {
  const { db, calls } = fakeDb();
  await mintAgentKey(db, { name: "simon", scopes: ["events:read"], createdBy: "master" });
  await listAgentKeys(db);
  const selects = calls.flatMap((c) => c.columns);
  assert.ok(selects.length >= 2);
  for (const cols of selects) {
    assert.notEqual(cols, "*");
    assert.equal(cols.includes("key_hash"), false);
  }
});
