/**
 * The Home's public MCP server — the protocol half of POST /api/mcp.
 *
 * JSON-RPC 2.0 over the Streamable HTTP transport's request/response form:
 * one POST carries one message or a batch, and the answer is plain JSON (no
 * SSE stream, no session id). Hand-rolled like the private Hermes endpoint
 * (src/app/api/agent/mcp/route.ts): the surface is small and MCP SDKs fight
 * the OpenNext/Workers bundle.
 *
 * Pure on purpose: no framework imports, no database. The route hands in the
 * caller, the tools and a context factory; `node --test` drives the rest.
 */

import { hasScope } from "../api/agent-key-scopes.ts";
import type { McpCaller, McpTool, McpToolSpec } from "./types.ts";
import { validateJson } from "./validate.ts";

export const MCP_SERVER_NAME = "digital-home";
/** The tool belt's own version. Bump it when a tool is added, removed or changes shape. */
export const MCP_SERVER_VERSION = "1.0.0";
/** Newest first. A client asking for one we do not know gets the newest. */
export const MCP_PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
] as const;

export const MCP_INSTRUCTIONS =
  "This is a Digital Home: the owner's CRM, content calendar, social studio and brand playbook. " +
  "Start with home.info and home.guide. Tools only read, write inside the Home (notes), or propose: " +
  "anything that would send, publish, spend or delete is a proposal the owner approves in the " +
  "approvals queue, and approvals.mine shows what became of yours. You only see the tools your key's scopes allow.";

export const RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  /** Server-defined: no key, or a key the Home does not know. */
  UNAUTHORIZED: -32001,
} as const;

export type RpcId = string | number | null;

export interface RpcResponse {
  jsonrpc: "2.0";
  id: RpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** What the route sends back: a status and a JSON body, or 202 with none. */
export interface McpHttpReply {
  status: number;
  body: RpcResponse | RpcResponse[] | null;
}

/** One executed tools/call, for the audit trail. */
export interface McpCallRecord {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  summary: string;
  ms: number;
}

export interface McpServerDeps<C> {
  tools: readonly McpTool<C>[];
  caller: McpCaller;
  /** Builds the handler's context for one tools/call (the route opens its audit row here). */
  createContext: (
    tool: McpToolSpec,
    args: Record<string, unknown>,
  ) => Promise<C> | C;
  /** Called after every executed tools/call. A failure here never fails the call. */
  audit?: (record: McpCallRecord, ctx: C) => Promise<void>;
  /** Last pass over every text the server returns (the route strips secrets). */
  redact?: (text: string) => string;
  now?: () => number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function rpcResult(id: RpcId, result: unknown): RpcResponse {
  return { jsonrpc: "2.0", id, result };
}

export function rpcError(
  id: RpcId,
  code: number,
  message: string,
  data?: unknown,
): RpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

/** The token in `Authorization: Bearer <token>`, or null. */
export function bearerToken(header: string | null | undefined): string | null {
  const match = (header || "").match(/^Bearer\s+(.+)$/i);
  const token = match?.[1].trim();
  return token ? token : null;
}

export function isSupportedProtocolVersion(version: string): boolean {
  return (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(version);
}

/** Echo the client's version when we speak it, else offer our newest. */
export function negotiateProtocolVersion(requested: unknown): string {
  return typeof requested === "string" && isSupportedProtocolVersion(requested)
    ? requested
    : MCP_PROTOCOL_VERSIONS[0];
}

/** The scopes a tool needs that the caller lacks. Empty: the caller may use it. */
export function missingScopes(
  tool: McpToolSpec,
  scopes: readonly string[],
): string[] {
  return tool.scopes.filter((scope) => !hasScope(scopes, scope));
}

/** The tools a caller's scopes reach. */
export function toolsForScopes<T extends McpToolSpec>(
  tools: readonly T[],
  scopes: readonly string[],
): T[] {
  return tools.filter((tool) => missingScopes(tool, scopes).length === 0);
}

/** A tool as tools/list shows it. Scope and approval travel in _meta. */
export function describeTool(tool: McpToolSpec) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: {
      title: tool.title,
      readOnlyHint: tool.readOnly,
      destructiveHint: false,
    },
    _meta: {
      "digital-home/scopes": tool.scopes,
      "digital-home/approval": tool.approval,
    },
  };
}

/** Field names that hold a capability or a secret: never returned to an agent. */
const SECRET_FIELD = /(^|_)(token|secret|password|api_key|key_hash|cookie)$/i;

/**
 * A copy of `data` without secret-shaped fields, at any depth (a lead's
 * unsubscribe_token, a setting's *_secret). Tools return records whole, so
 * this is the one place the rule lives. A field goes when its name says
 * secret and its value looks like a credential (a string with no spaces);
 * prose under such a name stays, so the route guide can still explain
 * signing ("secret": "The shared signing secret ...").
 */
export function stripSecretFields(data: unknown): unknown {
  if (Array.isArray(data)) return data.map(stripSecretFields);
  if (!isRecord(data)) return data;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const credential = typeof value !== "string" || !/\s/.test(value);
    if (
      SECRET_FIELD.test(key) &&
      credential &&
      !isRecord(value) &&
      !Array.isArray(value)
    )
      continue;
    out[key] = stripSecretFields(value);
  }
  return out;
}

function toolText(data: unknown, redact: (text: string) => string): string {
  return redact(
    typeof data === "string"
      ? data
      : JSON.stringify(stripSecretFields(data) ?? null),
  );
}

function toolError(
  id: RpcId,
  data: Record<string, unknown>,
  redact: (text: string) => string,
): RpcResponse {
  return rpcResult(id, {
    content: [{ type: "text", text: toolText(data, redact) }],
    isError: true,
  });
}

async function callTool<C>(
  id: RpcId,
  params: Record<string, unknown>,
  deps: McpServerDeps<C>,
): Promise<RpcResponse> {
  const redact = deps.redact || ((text: string) => text);
  const name = params.name;
  if (typeof name !== "string" || !name) {
    return rpcError(
      id,
      RPC_ERRORS.INVALID_PARAMS,
      "params.name must be the tool's name",
    );
  }
  const tool = deps.tools.find((t) => t.name === name);
  if (!tool)
    return rpcError(id, RPC_ERRORS.INVALID_PARAMS, `Unknown tool: ${name}`);
  if (params.arguments !== undefined && !isRecord(params.arguments)) {
    return rpcError(
      id,
      RPC_ERRORS.INVALID_PARAMS,
      "params.arguments must be an object",
    );
  }
  const args = (params.arguments as Record<string, unknown> | undefined) || {};

  // Refusals the agent can act on come back as tool errors, so the model sees them.
  const missing = missingScopes(tool, deps.caller.scopes);
  if (missing.length) {
    return toolError(
      id,
      {
        error: `This key lacks the scope(s) ${tool.name} needs`,
        missing_scopes: missing,
      },
      redact,
    );
  }
  const problems = validateJson(tool.inputSchema, args);
  if (problems.length) {
    return toolError(
      id,
      { error: `Invalid arguments for ${tool.name}`, problems },
      redact,
    );
  }

  const now = deps.now || Date.now;
  let ctx: C;
  try {
    ctx = await deps.createContext(tool, args);
  } catch (e) {
    return toolError(
      id,
      { error: e instanceof Error ? e.message : "Could not start the call" },
      redact,
    );
  }

  const started = now();
  let reply: RpcResponse;
  let record: McpCallRecord;
  try {
    const outcome = await tool.handler(args, ctx);
    record = {
      tool: tool.name,
      args,
      ok: true,
      summary: outcome.summary,
      ms: now() - started,
    };
    reply = rpcResult(id, {
      content: [{ type: "text", text: toolText(outcome.data, redact) }],
      isError: false,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Tool failed";
    record = {
      tool: tool.name,
      args,
      ok: false,
      summary: redact(message),
      ms: now() - started,
    };
    reply = toolError(id, { error: message }, redact);
  }
  if (deps.audit) await deps.audit(record, ctx).catch(() => undefined);
  return reply;
}

/** One JSON-RPC message. Null when nothing is owed back (notifications, responses). */
export async function handleMcpMessage<C>(
  message: unknown,
  deps: McpServerDeps<C>,
): Promise<RpcResponse | null> {
  if (!isRecord(message)) {
    return rpcError(
      null,
      RPC_ERRORS.INVALID_REQUEST,
      "Invalid Request: expected a JSON-RPC object",
    );
  }
  const hasId = "id" in message;
  const rawId = message.id;
  if (
    hasId &&
    !(typeof rawId === "string" || typeof rawId === "number" || rawId === null)
  ) {
    return rpcError(
      null,
      RPC_ERRORS.INVALID_REQUEST,
      "Invalid Request: id must be a string or a number",
    );
  }
  const id = (hasId ? rawId : null) as RpcId;

  if (typeof message.method !== "string") {
    // A response to a server-initiated request. This server sends none; drop it.
    if (hasId && ("result" in message || "error" in message)) return null;
    return rpcError(
      id,
      RPC_ERRORS.INVALID_REQUEST,
      "Invalid Request: method is required",
    );
  }
  if (message.jsonrpc !== "2.0") {
    return hasId
      ? rpcError(
          id,
          RPC_ERRORS.INVALID_REQUEST,
          'Invalid Request: jsonrpc must be "2.0"',
        )
      : null;
  }
  // Notifications (notifications/initialized, notifications/cancelled, ...) are accepted and owe nothing.
  if (!hasId) return null;

  const params = isRecord(message.params) ? message.params : {};
  if (message.params !== undefined && !isRecord(message.params)) {
    return rpcError(id, RPC_ERRORS.INVALID_PARAMS, "params must be an object");
  }

  switch (message.method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion: negotiateProtocolVersion(params.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
        instructions: MCP_INSTRUCTIONS,
      });
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, {
        tools: toolsForScopes(deps.tools, deps.caller.scopes).map(describeTool),
      });
    case "tools/call":
      return callTool(id, params, deps);
    default:
      return rpcError(
        id,
        RPC_ERRORS.METHOD_NOT_FOUND,
        `Method not found: ${message.method}`,
      );
  }
}

/** A whole POST body: one message or a batch. */
export async function handleMcpBody<C>(
  text: string,
  deps: McpServerDeps<C>,
): Promise<McpHttpReply> {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return {
      status: 400,
      body: rpcError(
        null,
        RPC_ERRORS.PARSE_ERROR,
        "Parse error: the body is not JSON",
      ),
    };
  }

  if (Array.isArray(payload)) {
    if (payload.length === 0) {
      return {
        status: 400,
        body: rpcError(
          null,
          RPC_ERRORS.INVALID_REQUEST,
          "Invalid Request: empty batch",
        ),
      };
    }
    // In order, one at a time: a batch may read what an earlier call wrote.
    const replies: RpcResponse[] = [];
    for (const message of payload) {
      const reply = await handleMcpMessage(message, deps);
      if (reply) replies.push(reply);
    }
    return replies.length
      ? { status: 200, body: replies }
      : { status: 202, body: null };
  }

  const reply = await handleMcpMessage(payload, deps);
  if (!reply) return { status: 202, body: null };
  const malformed =
    reply.id === null && reply.error?.code === RPC_ERRORS.INVALID_REQUEST;
  return { status: malformed ? 400 : 200, body: reply };
}

/** The 401 body: a JSON-RPC error, since MCP clients parse every answer as one. */
export function unauthorizedReply(error: string): RpcResponse {
  return rpcError(null, RPC_ERRORS.UNAUTHORIZED, `Unauthorized: ${error}`);
}

// ── HTTP ────────────────────────────────────────────────────────────────────

/** The parts of a request the door reads. */
export interface McpHttpRequest {
  method: string;
  header: (name: string) => string | null;
  text: () => Promise<string>;
}

export interface McpHttpResponse {
  status: number;
  headers: Record<string, string>;
  /** JSON body, or null for an empty one. */
  body: unknown;
}

export interface McpHttpDeps<C> {
  tools: readonly McpTool<C>[];
  authenticate: (
    token: string | null,
  ) => Promise<{ ok: true; caller: McpCaller } | { ok: false; error: string }>;
  /** The per-request server pieces, built only once the caller is known. */
  serve: (
    caller: McpCaller,
    token: string,
  ) => Omit<McpServerDeps<C>, "tools" | "caller">;
}

const NO_STORE = { "Cache-Control": "no-store" };
const ALLOW = "GET, POST";

/**
 * The whole of /api/mcp over HTTP, framework-free: the route only adapts
 * NextRequest in and Response out.
 *
 * - POST: bearer auth (401 with a JSON-RPC body), the MCP-Protocol-Version
 *   header (one we do not speak is a 400), then handleMcpBody; 202 and no
 *   body when nothing is owed back.
 * - GET: a short self-description, no auth. A client asking for an SSE
 *   stream gets 405: this server answers on POST only.
 * - Anything else: 405.
 */
export async function handleMcpHttp<C>(
  request: McpHttpRequest,
  deps: McpHttpDeps<C>,
): Promise<McpHttpResponse> {
  const method = request.method.toUpperCase();

  if (method === "GET") {
    if ((request.header("accept") || "").includes("text/event-stream")) {
      return { status: 405, headers: { Allow: ALLOW }, body: null };
    }
    return {
      status: 200,
      headers: NO_STORE,
      body: {
        name: MCP_SERVER_NAME,
        version: MCP_SERVER_VERSION,
        protocol: "Model Context Protocol, Streamable HTTP (JSON responses)",
        protocol_versions: MCP_PROTOCOL_VERSIONS,
        endpoint: "POST /api/mcp",
        auth: "Authorization: Bearer <key>. A key's scopes decide which tools it sees.",
        tools: deps.tools.map((tool) => ({
          name: tool.name,
          scopes: tool.scopes,
          approval: tool.approval,
        })),
        docs: "MCP.md in the backend repository",
      },
    };
  }

  if (method !== "POST") {
    return {
      status: 405,
      headers: { Allow: ALLOW, ...NO_STORE },
      body: rpcError(
        null,
        RPC_ERRORS.INVALID_REQUEST,
        "Method not allowed: POST JSON-RPC to /api/mcp",
      ),
    };
  }

  const token = bearerToken(request.header("authorization"));
  const auth = await deps.authenticate(token);
  if (!auth.ok) {
    return {
      status: 401,
      headers: {
        ...NO_STORE,
        "WWW-Authenticate": `Bearer realm="${MCP_SERVER_NAME}"`,
      },
      body: unauthorizedReply(auth.error),
    };
  }

  const version = request.header("mcp-protocol-version");
  if (version && !isSupportedProtocolVersion(version)) {
    return {
      status: 400,
      headers: NO_STORE,
      body: rpcError(
        null,
        RPC_ERRORS.INVALID_REQUEST,
        `Unsupported MCP-Protocol-Version ${version}`,
        {
          supported: MCP_PROTOCOL_VERSIONS,
        },
      ),
    };
  }

  const reply = await handleMcpBody(await request.text(), {
    ...deps.serve(auth.caller, token as string),
    tools: deps.tools,
    caller: auth.caller,
  });
  return { status: reply.status, headers: NO_STORE, body: reply.body };
}
