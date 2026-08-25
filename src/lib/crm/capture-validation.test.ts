import assert from "node:assert/strict";
import test from "node:test";
import { isUuid, validUuidValues } from "./capture-validation.ts";

test("interested offers accept UUIDs and reject arbitrary public strings", () => {
  const offerId = "123e4567-e89b-12d3-a456-426614174000";

  assert.equal(isUuid(offerId), true);
  assert.equal(isUuid("offer-x-paid"), false);
  assert.deepEqual(validUuidValues([offerId, " offer-x-paid ", offerId]), [offerId]);
});
