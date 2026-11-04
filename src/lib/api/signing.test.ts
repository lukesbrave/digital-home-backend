import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSigningPayload,
  computeSignature,
  perKeySigningEnabled,
  signaturesMatch,
  signingSecretFor,
} from "./signing.ts";

const MASTER = "master-secret-value";
const SIGNING = "separate-signing-secret";
const AGENT_KEY = "content-agent-key-value";

test("the flag is off unless set to a truthy word", () => {
  assert.equal(perKeySigningEnabled({}), false);
  assert.equal(perKeySigningEnabled({ API_PER_KEY_SIGNING: "false" }), false);
  assert.equal(perKeySigningEnabled({ API_PER_KEY_SIGNING: "0" }), false);
  assert.equal(perKeySigningEnabled({ API_PER_KEY_SIGNING: "true" }), true);
  assert.equal(perKeySigningEnabled({ API_PER_KEY_SIGNING: "1" }), true);
  assert.equal(perKeySigningEnabled({ API_PER_KEY_SIGNING: " On " }), true);
});

test("flag off: every key signs with the shared signing secret (today's behaviour)", () => {
  const env = { API_SECRET_KEY: MASTER, API_REQUEST_SIGNING_SECRET: SIGNING };
  assert.equal(signingSecretFor("master", MASTER, env), SIGNING);
  assert.equal(signingSecretFor("content_agent", AGENT_KEY, env), SIGNING);
});

test("flag off, no separate signing secret: the master key is the signing secret", () => {
  const env = { API_SECRET_KEY: MASTER };
  assert.equal(signingSecretFor("content_agent", AGENT_KEY, env), MASTER);
});

test("flag on: a named agent signs with its own key, the master with the shared secret", () => {
  const env = { API_SECRET_KEY: MASTER, API_REQUEST_SIGNING_SECRET: SIGNING, API_PER_KEY_SIGNING: "true" };
  assert.equal(signingSecretFor("content_agent", AGENT_KEY, env), AGENT_KEY);
  assert.equal(signingSecretFor("hermes", "hermes-key", env), "hermes-key");
  assert.equal(signingSecretFor("master", MASTER, env), SIGNING);
});

test("flag on: a signature made with the master secret no longer passes for an agent key", () => {
  const env = { API_SECRET_KEY: MASTER, API_PER_KEY_SIGNING: "1" };
  const payload = buildSigningPayload("post", "/api/crm/leads", "1700000000", '{"a":1}');
  const signedWithMaster = computeSignature(MASTER, payload);
  const expected = computeSignature(signingSecretFor("content_agent", AGENT_KEY, env)!, payload);
  assert.equal(signaturesMatch(expected, signedWithMaster), false);
  assert.equal(signaturesMatch(expected, computeSignature(AGENT_KEY, payload)), true);
});

test("no signing secret configured at all returns undefined", () => {
  assert.equal(signingSecretFor("master", "", {}), undefined);
});

test("payload is METHOD:pathname:timestamp:body with the method upper-cased", () => {
  assert.equal(buildSigningPayload("get", "/api/x", "1", ""), "GET:/api/x:1:");
});

test("signatures compare case-insensitively, accept a sha256= prefix, and reject length mismatches", () => {
  const sig = computeSignature("k", "p");
  assert.equal(signaturesMatch(sig, sig.toUpperCase()), true);
  assert.equal(signaturesMatch(sig, `sha256=${sig}`), true);
  assert.equal(signaturesMatch(sig, sig.slice(1)), false);
  assert.equal(signaturesMatch(sig, ""), false);
});
