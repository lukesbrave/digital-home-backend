import assert from "node:assert/strict";
import test from "node:test";
import { socialPublishingEnabled, socialUnavailable } from "./feature.ts";

test("existing deployments stay enabled; only an explicit true enables a configured value", () => {
  assert.equal(socialPublishingEnabled(undefined), true);
  assert.equal(socialPublishingEnabled("true"), true);
  assert.equal(socialPublishingEnabled(" TRUE "), true);
  for (const value of ["false", "", "0", "off", "typo"]) assert.equal(socialPublishingEnabled(value), false);
});
test("off blocks every social operation while CRM and article routes remain available", async () => {
  for (const path of ["/api/social", "/api/social/tick", "/api/social/posts", "/api/social/posts/id/publish", "/api/social/upload", "/api/social/upload/part", "/api/social/upload/complete", "/api/social/accounts/id", "/api/social/oauth/meta", "/api/social/oauth/google", "/api/%73ocial/posts"]) {
    const response = socialUnavailable(path, false)!;
    assert.equal(response.status, 403, path);
    assert.equal((await response.json()).code, "SOCIAL_PUBLISHING_DISABLED");
    assert.equal(socialUnavailable(path, true), null);
  }
  for (const path of ["/api/crm/tick", "/api/write-article", "/api/socialize", "/social"]) assert.equal(socialUnavailable(path, false), null);
});
