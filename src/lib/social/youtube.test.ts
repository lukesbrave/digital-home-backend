import assert from "node:assert/strict";
import test from "node:test";
import { YT_UPLOAD_CHUNK_SIZE, ytResumeVideoUpload, ytStartVideoUpload, type YouTubeUploadRef } from "./youtube.ts";

test("starts a resumable session without reading video bytes", async (t) => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    if (init?.method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: { "content-length": "12345", "content-type": "video/mp4" },
      });
    }
    return new Response(null, {
      status: 200,
      headers: { location: "https://upload.example/session-one" },
    });
  };

  const ref = await ytStartVideoUpload("token", {
    videoUrl: "https://media.example/reel.mp4",
    title: "A title",
    description: "A description",
  });

  assert.deepEqual(ref, {
    youtube_upload_url: "https://upload.example/session-one",
    video_url: "https://media.example/reel.mp4",
    content_length: 12345,
    content_type: "video/mp4",
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].init?.method, "HEAD");
  assert.equal(requests[1].init?.method, "POST");
  assert.equal(requests.some((request) => request.init?.method === "GET"), false);
});

test("uploads fixed-size chunks and returns the final video id", async (t) => {
  const total = YT_UPLOAD_CHUNK_SIZE + 2;
  const ref: YouTubeUploadRef = {
    youtube_upload_url: "https://upload.example/session-two",
    video_url: "https://media.example/reel.mp4",
    content_length: total,
    content_type: "video/mp4",
  };
  const contentRanges: string[] = [];
  const sourceRanges: string[] = [];
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    if (url === ref.video_url) {
      const range = headers.get("range") || "";
      sourceRanges.push(range);
      const match = range.match(/bytes=(\d+)-(\d+)/);
      assert.ok(match);
      return new Response(new Uint8Array(Number(match[2]) - Number(match[1]) + 1), {
        status: 206,
      });
    }
    const contentRange = headers.get("content-range") || "";
    contentRanges.push(contentRange);
    if (contentRange.startsWith("bytes */")) return new Response(null, { status: 308 });
    if (contentRanges.length === 2) {
      return new Response(null, {
        status: 308,
        headers: { range: `bytes=0-${YT_UPLOAD_CHUNK_SIZE - 1}` },
      });
    }
    return Response.json({ id: "video-123" }, { status: 201 });
  };

  const result = await ytResumeVideoUpload("token", ref);

  assert.deepEqual(result, {
    videoId: "video-123",
    url: "https://www.youtube.com/shorts/video-123",
  });
  assert.deepEqual(sourceRanges, [
    `bytes=0-${YT_UPLOAD_CHUNK_SIZE - 1}`,
    `bytes=${YT_UPLOAD_CHUNK_SIZE}-${total - 1}`,
  ]);
  assert.deepEqual(contentRanges, [
    `bytes */${total}`,
    `bytes 0-${YT_UPLOAD_CHUNK_SIZE - 1}/${total}`,
    `bytes ${YT_UPLOAD_CHUNK_SIZE}-${total - 1}/${total}`,
  ]);
});

test("probes a persisted session and resumes from Google's accepted offset", async (t) => {
  const ref: YouTubeUploadRef = {
    youtube_upload_url: "https://upload.example/session-three",
    video_url: "https://media.example/reel.mp4",
    content_length: 10,
    content_type: "video/mp4",
  };
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  let sourceRange = "";
  globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    if (String(input) === ref.video_url) {
      sourceRange = headers.get("range") || "";
      return new Response(new Uint8Array(5), { status: 206 });
    }
    if ((headers.get("content-range") || "").startsWith("bytes */")) {
      return new Response(null, { status: 308, headers: { range: "bytes=0-4" } });
    }
    return Response.json({ id: "resumed-video" }, { status: 201 });
  };

  await ytResumeVideoUpload("token", ref);
  assert.equal(sourceRange, "bytes=5-9");
});
