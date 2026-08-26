import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { fbFetchMetrics } from "./meta.ts";

type FetchHandler = (fields: string) => Response;

function mockGraph(t: TestContext, handler: FetchHandler) {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (input) => {
    const fields = new URL(String(input)).searchParams.get("fields") || "";
    return handler(fields);
  };
}

function graphError(message = "invalid metric"): Response {
  return Response.json({ error: { message, code: 100 } }, { status: 400 });
}

test("Facebook Reel metrics exclude the retired reach metric and retain engagement", async (t) => {
  const requested: string[] = [];
  mockGraph(t, (fields) => {
    requested.push(fields);
    if (fields.includes("blue_reels_play_count")) {
      return Response.json({
        video_insights: {
          data: [{ name: "blue_reels_play_count", values: [{ value: 42 }] }],
        },
      });
    }
    if (fields.includes("post_video_social_actions")) {
      return Response.json({
        video_insights: {
          data: [{ name: "post_video_social_actions", values: [{ value: { shares: 3 } }] }],
        },
      });
    }
    return Response.json({
      likes: { summary: { total_count: 7 } },
      comments: { summary: { total_count: 2 } },
    });
  });

  const snapshot = await fbFetchMetrics("video-1", "page-token");

  assert.equal(requested.length, 3);
  assert.equal(requested.some((fields) => fields.includes("post_impressions_unique")), false);
  assert.deepEqual(
    {
      views: snapshot.views,
      likes: snapshot.likes,
      comments: snapshot.comments,
      shares: snapshot.shares,
      reach: snapshot.reach,
    },
    { views: 42, likes: 7, comments: 2, shares: 3, reach: 0 }
  );
});

test("one retired or unavailable Reel metric cannot discard the remaining snapshot", async (t) => {
  mockGraph(t, (fields) => {
    if (fields.includes("blue_reels_play_count")) return graphError();
    if (fields.includes("post_video_social_actions")) {
      return Response.json({ video_insights: { data: [] } });
    }
    return Response.json({
      likes: { summary: { total_count: 5 } },
      comments: { summary: { total_count: 1 } },
    });
  });

  const snapshot = await fbFetchMetrics("video-2", "page-token");

  assert.equal(snapshot.views, 0);
  assert.equal(snapshot.likes, 5);
  assert.equal(snapshot.comments, 1);
  assert.match(String((snapshot.raw as { errors?: { plays?: string } }).errors?.plays), /invalid metric/);
});

test("Facebook Reel metrics still fail visibly when every Graph request fails", async (t) => {
  mockGraph(t, () => graphError("token expired"));

  await assert.rejects(
    () => fbFetchMetrics("video-3", "page-token"),
    /Facebook Reel metrics unavailable.*token expired/
  );
});
