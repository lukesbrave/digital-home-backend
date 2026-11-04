import assert from "node:assert/strict";
import test from "node:test";
import {
  bearerToken,
  handleMcpBody,
  stripSecretFields,
  MCP_PROTOCOL_VERSIONS,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  RPC_ERRORS,
  type McpCallRecord,
  type McpServerDeps,
  type RpcResponse,
} from "./server.ts";
import { MCP_TOOL_SPECS } from "./tools/catalog.ts";
import type { McpCaller, McpTool } from "./types.ts";

type Ctx = { calls: string[] };

const MASTER: McpCaller = { agent: "master", scopes: ["*"], kind: "env" };
const READER: McpCaller = {
  agent: "reader",
  scopes: ["leads:read"],
  kind: "minted",
};

/** The real catalog, each handler echoing its arguments. */
function catalogTools(): McpTool<Ctx>[] {
  return MCP_TOOL_SPECS.map((spec) => ({
    ...spec,
    handler: async (args, ctx) => {
      ctx.calls.push(spec.name);
      if (args.query === "boom")
        throw new Error("database exploded with key sk-secret-123456");
      return { data: { tool: spec.name, args }, summary: `ran ${spec.name}` };
    },
  }));
}

function harness(caller: McpCaller = MASTER) {
  const ctx: Ctx = { calls: [] };
  const audited: McpCallRecord[] = [];
  const deps: McpServerDeps<Ctx> = {
    tools: catalogTools(),
    caller,
    createContext: () => ctx,
    audit: async (record) => {
      audited.push(record);
    },
    redact: (text) => text.split("sk-secret-123456").join("[redacted]"),
  };
  const post = (body: unknown) =>
    handleMcpBody(typeof body === "string" ? body : JSON.stringify(body), deps);
  return { ctx, audited, post };
}

function single(reply: {
  body: RpcResponse | RpcResponse[] | null;
}): RpcResponse {
  assert.ok(reply.body && !Array.isArray(reply.body), "expected one response");
  return reply.body as RpcResponse;
}

function toolPayload(response: RpcResponse) {
  const result = response.result as {
    content: { type: string; text: string }[];
    isError: boolean;
  };
  assert.equal(result.content[0].type, "text");
  return { isError: result.isError, data: JSON.parse(result.content[0].text) };
}

test("initialize answers with the server's identity and the client's protocol version", async () => {
  const { post } = harness();
  const reply = await post({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "claude-code", version: "2" },
    },
  });
  assert.equal(reply.status, 200);
  const response = single(reply);
  assert.equal(response.id, 1);
  const result = response.result as Record<string, unknown>;
  assert.equal(result.protocolVersion, "2025-06-18");
  assert.deepEqual(result.serverInfo, {
    name: MCP_SERVER_NAME,
    version: MCP_SERVER_VERSION,
  });
  assert.equal(MCP_SERVER_NAME, "digital-home");
  assert.deepEqual(result.capabilities, { tools: { listChanged: false } });
  assert.equal(typeof result.instructions, "string");
});

test("initialize offers the newest version when the client's is unknown", async () => {
  const { post } = harness();
  const response = single(
    await post({
      jsonrpc: "2.0",
      id: "a",
      method: "initialize",
      params: { protocolVersion: "1999-01-01" },
    }),
  );
  assert.equal(
    (response.result as { protocolVersion: string }).protocolVersion,
    MCP_PROTOCOL_VERSIONS[0],
  );
});

test("notifications are accepted with 202 and no body; ping answers {}", async () => {
  const { post } = harness();
  assert.deepEqual(
    await post({ jsonrpc: "2.0", method: "notifications/initialized" }),
    { status: 202, body: null },
  );
  assert.deepEqual(
    single(await post({ jsonrpc: "2.0", id: 7, method: "ping" })),
    { jsonrpc: "2.0", id: 7, result: {} },
  );
});

test("tools/list shows every tool to a * key, with scope and approval in _meta", async () => {
  const { post } = harness();
  const tools = (
    single(await post({ jsonrpc: "2.0", id: 2, method: "tools/list" }))
      .result as { tools: Record<string, unknown>[] }
  ).tools;
  assert.equal(tools.length, MCP_TOOL_SPECS.length);
  const note = tools.find((t) => t.name === "leads.add_note")!;
  assert.deepEqual(note._meta, {
    "digital-home/scopes": ["leads:write"],
    "digital-home/approval": "none",
  });
  assert.equal(
    (note.annotations as { readOnlyHint: boolean }).readOnlyHint,
    false,
  );
  assert.equal(
    note.inputSchema && (note.inputSchema as { type: string }).type,
    "object",
  );
  assert.ok(!("handler" in note));
});

test("tools/list is filtered to the caller's scopes", async () => {
  const { post } = harness(READER);
  const tools = (
    single(await post({ jsonrpc: "2.0", id: 2, method: "tools/list" }))
      .result as { tools: { name: string }[] }
  ).tools;
  assert.deepEqual(
    tools.map((t) => t.name),
    [
      "home.info",
      "home.guide",
      "leads.search",
      "leads.get",
      "leads.timeline",
      "pipeline.list",
      "approvals.mine",
    ],
  );

  // Every scope a tool lists is required: approvals:propose alone does not reach pipeline.move.
  const proposer = harness({
    agent: "bob",
    scopes: ["approvals:propose"],
    kind: "minted",
  });
  const proposerTools = (
    single(await proposer.post({ jsonrpc: "2.0", id: 3, method: "tools/list" }))
      .result as { tools: { name: string }[] }
  ).tools;
  assert.deepEqual(
    proposerTools.map((t) => t.name),
    ["home.info", "home.guide", "approvals.list", "approvals.mine"],
  );

  // A key with no scopes still sees the tools every key may use.
  const none = harness({ agent: "empty", scopes: [], kind: "minted" });
  const empty = single(
    await none.post({ jsonrpc: "2.0", id: 3, method: "tools/list" }),
  );
  assert.deepEqual(
    (empty.result as { tools: { name: string }[] }).tools.map((t) => t.name),
    ["home.info", "home.guide", "approvals.mine"],
  );
});

test("tools/call runs the handler, returns JSON text and audits the call", async () => {
  const { post, ctx, audited } = harness(READER);
  const response = single(
    await post({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "leads.search", arguments: { query: "ana", limit: 5 } },
    }),
  );
  const { isError, data } = toolPayload(response);
  assert.equal(isError, false);
  assert.deepEqual(data, {
    tool: "leads.search",
    args: { query: "ana", limit: 5 },
  });
  assert.deepEqual(ctx.calls, ["leads.search"]);
  assert.equal(audited.length, 1);
  assert.equal(audited[0].ok, true);
  assert.equal(audited[0].summary, "ran leads.search");
});

test("tools/call without arguments passes an empty object", async () => {
  const { post } = harness();
  const { data } = toolPayload(
    single(
      await post({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "home.info" },
      }),
    ),
  );
  assert.deepEqual(data.args, {});
});

test("a handler that throws comes back as isError, redacted, and is audited as failed", async () => {
  const { post, audited } = harness();
  const { isError, data } = toolPayload(
    single(
      await post({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "leads.search", arguments: { query: "boom" } },
      }),
    ),
  );
  assert.equal(isError, true);
  assert.equal(data.error, "database exploded with key [redacted]");
  assert.equal(audited[0].ok, false);
  assert.ok(!audited[0].summary.includes("sk-secret"));
});

test("a tool outside the key's scopes is refused as a tool error and never runs", async () => {
  const { post, ctx, audited } = harness(READER);
  const { isError, data } = toolPayload(
    single(
      await post({
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: {
          name: "leads.add_note",
          arguments: { note: "hi", email: "a@b.co" },
        },
      }),
    ),
  );
  assert.equal(isError, true);
  assert.deepEqual(data.missing_scopes, ["leads:write"]);
  assert.deepEqual(ctx.calls, []);
  assert.equal(audited.length, 0);
});

test("arguments are validated against the tool's schema before the handler runs", async () => {
  const { post, ctx } = harness();
  const call = async (name: string, args: unknown) =>
    toolPayload(
      single(
        await post({
          jsonrpc: "2.0",
          id: 8,
          method: "tools/call",
          params: { name, arguments: args },
        }),
      ),
    );

  const tooMany = await call("leads.search", {
    limit: 500,
    status: "hot",
    since_days: 1.5,
    color: "red",
  });
  assert.equal(tooMany.isError, true);
  assert.deepEqual(tooMany.data.problems.sort(), [
    "arguments.color: is not a known argument",
    "arguments.limit: must be <= 100",
    "arguments.since_days: expected integer, got number",
    'arguments.status: must be one of "new", "engaged", "qualified", "converted", "lost"',
  ]);

  const missing = await call("leads.add_note", { email: "a@b.co" });
  assert.deepEqual(missing.data.problems, ["arguments.note: is required"]);

  const wrongType = await call("leads.get", { email: 42 });
  assert.deepEqual(wrongType.data.problems, [
    "arguments.email: expected string, got integer",
  ]);

  const badItem = await call("social.propose", {
    caption: "hi",
    platforms: ["tiktok"],
  });
  assert.equal(badItem.data.problems.length, 1);
  assert.match(
    badItem.data.problems[0],
    /^arguments\.platforms\[0\]: must be one of/,
  );

  assert.deepEqual(ctx.calls, []);
});

test("protocol errors use JSON-RPC codes", async () => {
  const { post } = harness();
  const error = async (body: unknown) => single(await post(body)).error!;

  assert.equal(
    (await error({ jsonrpc: "2.0", id: 1, method: "resources/list" })).code,
    RPC_ERRORS.METHOD_NOT_FOUND,
  );
  assert.equal(
    (
      await error({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "nope" },
      })
    ).code,
    RPC_ERRORS.INVALID_PARAMS,
  );
  assert.equal(
    (await error({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {} }))
      .code,
    RPC_ERRORS.INVALID_PARAMS,
  );
  assert.equal(
    (
      await error({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "home.info", arguments: [1] },
      })
    ).code,
    RPC_ERRORS.INVALID_PARAMS,
  );
  assert.equal(
    (await error({ jsonrpc: "2.0", id: 1, method: "ping", params: "x" })).code,
    RPC_ERRORS.INVALID_PARAMS,
  );
  assert.equal(
    (await error({ jsonrpc: "1.0", id: 1, method: "ping" })).code,
    RPC_ERRORS.INVALID_REQUEST,
  );
  assert.equal(
    (await error({ jsonrpc: "2.0", id: { no: 1 }, method: "ping" })).code,
    RPC_ERRORS.INVALID_REQUEST,
  );

  const parse = await post("{not json");
  assert.equal(parse.status, 400);
  assert.equal(single(parse).error!.code, RPC_ERRORS.PARSE_ERROR);

  const notObject = await post("42");
  assert.equal(notObject.status, 400);
  assert.equal(single(notObject).error!.code, RPC_ERRORS.INVALID_REQUEST);
});

test("batches answer every request in order and skip notifications", async () => {
  const { post } = harness();
  const reply = await post([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: 3, method: "nope" },
    "garbage",
  ]);
  assert.equal(reply.status, 200);
  const responses = reply.body as RpcResponse[];
  assert.deepEqual(
    responses.map((r) => r.id),
    [1, 2, 3, null],
  );
  assert.equal(responses[2].error!.code, RPC_ERRORS.METHOD_NOT_FOUND);
  assert.equal(responses[3].error!.code, RPC_ERRORS.INVALID_REQUEST);

  assert.deepEqual(
    await post([{ jsonrpc: "2.0", method: "notifications/initialized" }]),
    { status: 202, body: null },
  );
  const empty = await post([]);
  assert.equal(empty.status, 400);
  assert.equal(single(empty).error!.code, RPC_ERRORS.INVALID_REQUEST);
});

test("a response from the client (to a request we never sent) is dropped", async () => {
  const { post } = harness();
  assert.deepEqual(await post({ jsonrpc: "2.0", id: 9, result: {} }), {
    status: 202,
    body: null,
  });
});

test("bearerToken reads Authorization: Bearer", () => {
  assert.equal(bearerToken("Bearer bbk_bob_abc"), "bbk_bob_abc");
  assert.equal(bearerToken("bearer   k1  "), "k1");
  assert.equal(bearerToken("Basic abc"), null);
  assert.equal(bearerToken("Bearer "), null);
  assert.equal(bearerToken(null), null);
});

test("stripSecretFields drops credential-shaped secret fields at any depth and keeps prose", () => {
  assert.deepEqual(
    stripSecretFields({
      lead: {
        email: "a@b.co",
        unsubscribe_token: "abc123",
        custom: { api_secret: "s3cr3t", note: "hi" },
      },
      rows: [{ skool_session_cookie: "ck", key_hash: "ff", tokens_used: 5 }],
      signing: { secret: "The shared signing secret, never sent." },
      upload_token: null,
    }),
    {
      lead: { email: "a@b.co", custom: { note: "hi" } },
      rows: [{ tokens_used: 5 }],
      signing: { secret: "The shared signing secret, never sent." },
    },
  );
});

test("inherited names cannot slip past additionalProperties: false", async () => {
  const { post } = harness();
  const body =
    '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"leads.search","arguments":{"constructor":1,"toString":"x","__proto__":{"limit":1}}}}';
  const { isError, data } = toolPayload(single(await post(body)));
  assert.equal(isError, true);
  assert.deepEqual(data.problems.sort(), [
    "arguments.__proto__: is not a known argument",
    "arguments.constructor: is not a known argument",
    "arguments.toString: is not a known argument",
  ]);
});
