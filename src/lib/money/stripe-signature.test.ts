import assert from "node:assert/strict";
import test from "node:test";
import { computeSignature, parseSignatureHeader, signPayload, verifyStripeSignature } from "./stripe-signature.ts";

// Fabricated: not a real endpoint secret.
const SECRET = "whsec_fabricated_for_tests";
const NOW = 1_761_500_000;
const BODY = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });

test("a payload signed with the endpoint secret verifies", () => {
  const header = signPayload(SECRET, BODY, NOW);
  assert.deepEqual(verifyStripeSignature({ payload: BODY, header, secret: SECRET, nowSeconds: NOW + 10 }), {
    ok: true,
    timestamp: NOW,
  });
});

test("a wrong secret, a tampered body or a re-serialised body does not", () => {
  const header = signPayload(SECRET, BODY, NOW);
  const check = (payload: string, secret = SECRET) =>
    verifyStripeSignature({ payload, header, secret, nowSeconds: NOW });
  assert.deepEqual(check(BODY, "whsec_other"), { ok: false, reason: "mismatch" });
  assert.deepEqual(check(BODY.replace("evt_1", "evt_2")), { ok: false, reason: "mismatch" });
  assert.deepEqual(check(JSON.stringify(JSON.parse(BODY), null, 2)), { ok: false, reason: "mismatch" });
});

test("a stale timestamp is refused, either side of the tolerance", () => {
  const header = signPayload(SECRET, BODY, NOW);
  assert.deepEqual(verifyStripeSignature({ payload: BODY, header, secret: SECRET, nowSeconds: NOW + 301 }), {
    ok: false,
    reason: "stale",
  });
  assert.deepEqual(verifyStripeSignature({ payload: BODY, header, secret: SECRET, nowSeconds: NOW - 301 }), {
    ok: false,
    reason: "stale",
  });
  assert.equal(verifyStripeSignature({ payload: BODY, header, secret: SECRET, nowSeconds: NOW + 300 }).ok, true);
  assert.equal(
    verifyStripeSignature({ payload: BODY, header, secret: SECRET, nowSeconds: NOW + 900, toleranceSeconds: 1000 }).ok,
    true
  );
});

test("missing, malformed and secretless checks say why", () => {
  assert.deepEqual(verifyStripeSignature({ payload: BODY, header: null, secret: SECRET }), { ok: false, reason: "missing_header" });
  assert.deepEqual(verifyStripeSignature({ payload: BODY, header: "t=abc,v1=zz", secret: SECRET }), {
    ok: false,
    reason: "malformed_header",
  });
  assert.deepEqual(verifyStripeSignature({ payload: BODY, header: `t=${NOW}`, secret: SECRET }), {
    ok: false,
    reason: "malformed_header",
  });
  assert.deepEqual(verifyStripeSignature({ payload: BODY, header: signPayload(SECRET, BODY, NOW), secret: "" }), {
    ok: false,
    reason: "no_secret",
  });
});

test("while a secret rolls, any matching v1 passes and v0 is ignored", () => {
  const good = computeSignature(SECRET, NOW, BODY);
  const old = computeSignature("whsec_old", NOW, BODY);
  const header = `t=${NOW},v1=${old},v1=${good},v0=${"0".repeat(64)}`;
  assert.deepEqual(parseSignatureHeader(header), { timestamp: NOW, signatures: [old, good] });
  assert.equal(verifyStripeSignature({ payload: BODY, header, secret: SECRET, nowSeconds: NOW }).ok, true);
  const onlyV0 = `t=${NOW},v0=${good}`;
  assert.equal(verifyStripeSignature({ payload: BODY, header: onlyV0, secret: SECRET, nowSeconds: NOW }).ok, false);
});
