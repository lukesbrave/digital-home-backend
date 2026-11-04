/** Generic tool runtime. Each tool call must open an audit row before running. */
import { NextRequest } from "next/server";
import { GET as homeRoute } from "@/app/api/home/route";
import { readTool } from "./reads";
import { ENV_AGENT_KEY_VARS } from "@/lib/api/agent-key-scopes";
import {
  buildSigningPayload,
  computeSignature,
  MASTER_AGENT,
  signingSecretFor,
} from "@/lib/api/signing";
import { loadBrandPlaybooks } from "@/lib/brand/playbook-store";
import type { AdminClient } from "@/lib/crm/types";
import type { Json } from "@/types/database";
import type { McpCallRecord } from "./server";
import type { McpCaller, McpToolContext } from "./types";

const ROUTES = {
  home: { handler: homeRoute, path: "/api/home" },
} as const;

/** The context one tools/call runs with; opens its audit row. */
export async function buildToolContext(
  supabase: AdminClient,
  caller: McpCaller,
  origin: string,
  tool: string,
): Promise<McpToolContext> {
  const runId = await openAuditRun(supabase, caller, tool);
  if (!runId)
    throw new Error(
      "MCP audit unavailable; apply the approvals migration first",
    );
  return {
    supabase,
    caller,
    origin,
    runId,
    actor: actorFor(caller),
    operator: (name, input) => readTool(supabase, name, input),
    route: (name, query) =>
      callRouteInProcess(
        ROUTES[name].handler,
        origin,
        ROUTES[name].path,
        query,
      ),
    loadBrandPlaybooks,
  };
}

export function actorFor(caller: McpCaller): string {
  return `agent:${caller.agent}`;
}

/** Opens the audit row for one tools/call. Never throws; null when the insert fails. */
export async function openAuditRun(
  supabase: AdminClient,
  caller: McpCaller,
  tool: string,
): Promise<string | null> {
  for (const trigger of ["chat"] as const) {
    const { data, error } = await supabase
      .from("agent_runs")
      .insert({
        trigger,
        status: "running",
        summary: `MCP · ${caller.agent} — ${tool}`,
      })
      .select("id")
      .single();
    if (data) return data.id;
    if (error && !/check constraint/i.test(error.message)) return null;
  }
  return null;
}

export async function closeAuditRun(
  supabase: AdminClient,
  ctx: McpToolContext,
  record: McpCallRecord,
): Promise<void> {
  if (!ctx.runId) return;
  const at = new Date().toISOString();
  await supabase
    .from("agent_runs")
    .update({
      status: record.ok ? "completed" : "failed",
      summary: `MCP · ${ctx.caller.agent} — ${record.tool}: ${record.summary}`,
      error: record.ok ? null : record.summary,
      tool_calls: [
        {
          tool: record.tool,
          input: record.args,
          actor: ctx.actor,
          via: "mcp",
          key_kind: ctx.caller.kind,
          summary: record.summary,
          ok: record.ok,
          ms: record.ms,
          at,
        },
      ] as unknown as Json,
      completed_at: at,
    })
    .eq("id", ctx.runId);
}

const SECRET_ENV_VARS = [
  "API_SECRET_KEY",
  "API_REQUEST_SIGNING_SECRET",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "RESEND_API_KEY",
  ...Object.values(ENV_AGENT_KEY_VARS),
];

/**
 * Scrubs the caller's own key, every configured secret and anything shaped
 * like a minted key out of a reply. A belt over the braces: no tool reads
 * secrets, but error messages pass text through from libraries.
 */
export function secretRedactor(
  token: string,
  env: Record<string, string | undefined> = process.env,
) {
  const secrets = [token, ...SECRET_ENV_VARS.map((name) => env[name])]
    .filter(
      (value): value is string =>
        typeof value === "string" && value.length >= 8,
    )
    .sort((a, b) => b.length - a.length);
  return (text: string): string => {
    let out = text;
    for (const secret of secrets) out = out.split(secret).join("[redacted]");
    return out.replace(/bbk_[a-z][a-z0-9_-]{1,39}_[0-9a-f]{32}/g, "[redacted]");
  };
}

/**
 * Calls one of this app's route handlers in-process, as a signed master
 * request, for tools whose logic lives only in a route. The MCP door has
 * already checked the caller's scope; the route sees the master key so its
 * own auth passes. Returns the parsed JSON, throwing on a non-2xx answer.
 */
export async function callRouteInProcess(
  handler: (request: NextRequest) => Promise<Response>,
  origin: string,
  path: string,
  query: Record<string, string> = {},
): Promise<unknown> {
  const apiKey = process.env.API_SECRET_KEY;
  const secret = apiKey ? signingSecretFor(MASTER_AGENT, apiKey) : undefined;
  if (!apiKey || !secret)
    throw new Error("API_SECRET_KEY is not configured on this Home");

  const url = new URL(path, origin);
  for (const [key, value] of Object.entries(query))
    url.searchParams.set(key, value);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = computeSignature(
    secret,
    buildSigningPayload("GET", url.pathname, timestamp, ""),
  );
  const request = new NextRequest(url, {
    method: "GET",
    headers: {
      "x-api-key": apiKey,
      "x-timestamp": timestamp,
      "x-signature": signature,
    },
  });

  const response = await handler(request);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      (body as { error?: string } | null)?.error ||
      `${url.pathname} answered ${response.status}`;
    throw new Error(message);
  }
  return body;
}
