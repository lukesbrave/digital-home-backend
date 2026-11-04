import assert from "node:assert/strict";
import test from "node:test";
import {
  handleMcpHttp,
  MCP_SERVER_NAME,
  RPC_ERRORS,
  type McpHttpDeps,
  type RpcResponse,
} from "./server.ts";
import { MCP_TOOL_SPECS } from "./tools/catalog.ts";
import type { McpTool } from "./types.ts";

const tools: McpTool<null>[] = MCP_TOOL_SPECS.map((spec) => ({
  ...spec,
  handler: async () => ({ data: { ok: true }, summary: "ok" }),
}));

function door() {
  let served = 0;
  const deps: McpHttpDeps<null> = {
    tools,
    authenticate: async (token) =>
      token === "good"
        ? { ok: true, caller: { agent: "master", scopes: ["*"], kind: "env" } }
        : { ok: false, error: "Invalid or revoked key" },
    serve: () => {
      served += 1;
      return { createContext: () => null };
    },
  };
  const send = (
    method: string,
    headers: Record<string, string> = {},
    body = "",
  ) =>
    handleMcpHttp(
      {
        method,
        header: (name) => headers[name.toLowerCase()] ?? null,
        text: async () => body,
      },
      deps,
    );
  return { send, served: () => served };
}

const PING = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });

test("POST without a key is a 401 with a JSON-RPC body and a Bearer challenge", async () => {
  const { send, served } = door();
  const cases: Record<string, string>[] = [
    {},
    { authorization: "Bearer bad" },
    { authorization: "Basic good" },
  ];
  for (const headers of cases) {
    const out = await send("POST", headers, PING);
    assert.equal(out.status, 401);
    assert.equal(
      out.headers["WWW-Authenticate"],
      `Bearer realm="${MCP_SERVER_NAME}"`,
    );
    const body = out.body as RpcResponse;
    assert.equal(body.jsonrpc, "2.0");
    assert.equal(body.id, null);
    assert.equal(body.error!.code, RPC_ERRORS.UNAUTHORIZED);
  }
  assert.equal(served(), 0, "nothing is built for a caller we do not know");
});

test("POST with a key answers JSON-RPC", async () => {
  const { send } = door();
  const out = await send("POST", { authorization: "Bearer good" }, PING);
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { jsonrpc: "2.0", id: 1, result: {} });
  assert.equal(out.headers["Cache-Control"], "no-store");
});

test("a notification is 202 with no body", async () => {
  const { send } = door();
  const out = await send(
    "POST",
    { authorization: "Bearer good" },
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  );
  assert.equal(out.status, 202);
  assert.equal(out.body, null);
});

test("MCP-Protocol-Version: a known one passes, an unknown one is a 400", async () => {
  const { send } = door();
  assert.equal(
    (
      await send(
        "POST",
        { authorization: "Bearer good", "mcp-protocol-version": "2025-06-18" },
        PING,
      )
    ).status,
    200,
  );
  const out = await send(
    "POST",
    { authorization: "Bearer good", "mcp-protocol-version": "1999-01-01" },
    PING,
  );
  assert.equal(out.status, 400);
  assert.equal(
    (out.body as RpcResponse).error!.code,
    RPC_ERRORS.INVALID_REQUEST,
  );
});

test("GET describes the door without auth; an SSE GET is 405", async () => {
  const { send } = door();
  const out = await send("GET");
  assert.equal(out.status, 200);
  const body = out.body as {
    name: string;
    tools: { name: string; scopes: string[]; approval: string }[];
  };
  assert.equal(body.name, "digital-home");
  assert.equal(body.tools.length, MCP_TOOL_SPECS.length);
  assert.deepEqual(
    body.tools.find((t) => t.name === "pipeline.move"),
    {
      name: "pipeline.move",
      scopes: ["approvals:propose", "leads:read"],
      approval: "proposes",
    },
  );

  const sse = await send("GET", { accept: "text/event-stream" });
  assert.equal(sse.status, 405);
  assert.equal(sse.headers.Allow, "GET, POST");
  assert.equal(sse.body, null);
});

test("PUT, PATCH and DELETE are 405 with a JSON-RPC body", async () => {
  const { send } = door();
  for (const method of ["PUT", "PATCH", "DELETE"]) {
    const out = await send(method, { authorization: "Bearer good" });
    assert.equal(out.status, 405, method);
    assert.equal(out.headers.Allow, "GET, POST");
    assert.equal(
      (out.body as RpcResponse).error!.code,
      RPC_ERRORS.INVALID_REQUEST,
    );
  }
});
