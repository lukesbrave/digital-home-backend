import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner requires the explicit .ts extension.
import { scheduledAtForImmediateAttempt } from "./retry.ts";

const originalSlot = "2026-08-20T03:00:00.000Z";
const retryTime = "2026-08-20T22:00:00.000Z";

test("failed retries preserve the original calendar slot", () => {
  assert.equal(
    scheduledAtForImmediateAttempt({ status: "failed", scheduled_at: originalSlot }, retryTime),
    originalSlot
  );
});

test("partial retries preserve the original calendar slot", () => {
  assert.equal(
    scheduledAtForImmediateAttempt({ status: "partial", scheduled_at: originalSlot }, retryTime),
    originalSlot
  );
});

test("publish-now actions use the current time", () => {
  for (const status of ["draft", "scheduled", "canceled"]) {
    assert.equal(
      scheduledAtForImmediateAttempt({ status, scheduled_at: originalSlot }, retryTime),
      retryTime
    );
  }
});

test("legacy retry rows without a slot fall back to the current time", () => {
  assert.equal(
    scheduledAtForImmediateAttempt({ status: "failed", scheduled_at: null }, retryTime),
    retryTime
  );
});
