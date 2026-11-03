import assert from "node:assert/strict";
import test from "node:test";
import { resolveMcpCaller, type MintedKeyLookup } from "./caller.ts";

const ENV = {
  API_SECRET_KEY: "master-key-123456",
  HERMES_MCP_KEY: "hermes-key-123456",
  CONTENT_AGENT_API_KEY: "content-key-123456",
  OPENCLAWD_API_KEY: "openclawd-key-123456",
};
const LIVE = "bbk_simon_0123456789abcdef0123456789abcdef";
const REVOKED = "bbk_bob_fedcba9876543210fedcba9876543210";

function lookup() {
  const asked: string[] = [];
  const fn: MintedKeyLookup = async (token) => {
    asked.push(token);
    return token === LIVE ? { name: "simon", scopes: ["leads:read"] } : null;
  };
  return { asked, fn };
}

test("only the master environment key can use bearer authentication", async () => {
  const { fn, asked } = lookup();
  assert.deepEqual(await resolveMcpCaller("master-key-123456", ENV, fn), {
    ok: true,
    caller: { agent: "master", scopes: ["*"], kind: "env" },
  });
  assert.equal(
    (await resolveMcpCaller("hermes-key-123456", ENV, fn)).ok,
    false,
  );
  assert.deepEqual(asked, [], "env keys never touch the database");
});

test("a live minted key comes in with only its own scopes", async () => {
  const { fn } = lookup();
  assert.deepEqual(await resolveMcpCaller(LIVE, ENV, fn), {
    ok: true,
    caller: { agent: "simon", scopes: ["leads:read"], kind: "minted" },
  });
});

test("a revoked or unknown minted key is refused", async () => {
  const { fn } = lookup();
  assert.deepEqual(await resolveMcpCaller(REVOKED, ENV, fn), {
    ok: false,
    error: "Invalid or revoked key",
  });
});

test("the other env-var agent keys are refused: elsewhere they must sign", async () => {
  const { fn, asked } = lookup();
  for (const key of ["content-key-123456", "openclawd-key-123456"]) {
    const result = await resolveMcpCaller(key, ENV, fn);
    assert.equal(result.ok, false);
    assert.match((result as { error: string }).error, /must sign/);
  }
  assert.deepEqual(asked, []);
});

test("garbage is refused; only bbk-shaped tokens reach the database", async () => {
  const { fn, asked } = lookup();
  for (const token of [
    "nope",
    "bbk_",
    "bbk_simon_xyz",
    "bbk_Simon_0123456789abcdef0123456789abcdef",
    "Bearer x",
  ]) {
    assert.equal((await resolveMcpCaller(token, ENV, fn)).ok, false, token);
  }
  assert.deepEqual(asked, []);
  assert.equal(
    (
      await resolveMcpCaller(
        "bbk_ghost_00000000000000000000000000000000",
        ENV,
        fn,
      )
    ).ok,
    false,
  );
  assert.deepEqual(asked, ["bbk_ghost_00000000000000000000000000000000"]);
});

test("a missing token, an unset env key, and a failing lookup are refusals, never open doors", async () => {
  const { fn } = lookup();
  assert.equal((await resolveMcpCaller(null, ENV, fn)).ok, false);
  assert.equal((await resolveMcpCaller("", {}, fn)).ok, false);
  assert.equal((await resolveMcpCaller("undefined", {}, fn)).ok, false);
  const broken: MintedKeyLookup = async () => {
    throw new Error("database down");
  };
  assert.deepEqual(await resolveMcpCaller(LIVE, ENV, broken), {
    ok: false,
    error: "Invalid or revoked key",
  });
});
