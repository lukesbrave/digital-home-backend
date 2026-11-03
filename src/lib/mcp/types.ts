/**
 * The shapes behind POST /api/mcp (see MCP.md). Types only, so `node --test`
 * imports it directly.
 */

import type { Scope } from "../api/agent-key-scopes.ts";
import type { AdminClient } from "../crm/types.ts";
import type { JsonSchema } from "./validate.ts";

/**
 * What a call can cause, in the guide's words (src/lib/home/agent-guide.ts):
 * `none` reads or writes inside the Home, `proposes` only queues an
 * agent_actions row the owner decides on. `outward` (send, publish, spend,
 * delete) is in the type so the tests can prove no tool carries it: outward
 * work is always a proposal the owner approves in the queue.
 */
export type McpApproval = "none" | "proposes" | "outward";

/** A tool's public half: what tools/list shows, minus the handler. */
export interface McpToolSpec {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema & { type: "object" };
  /** Every scope a caller needs to see and call this tool. Empty: any key. */
  scopes: readonly Scope[];
  approval: McpApproval;
  /** True when a call changes nothing (tools/list's readOnlyHint). */
  readOnly: boolean;
}

/** What a handler returns: `data` goes back to the agent as JSON text. */
export interface McpToolOutcome {
  data: unknown;
  /** One line for the audit row. */
  summary: string;
}

export interface McpTool<C = unknown> extends McpToolSpec {
  handler: (args: Record<string, unknown>, ctx: C) => Promise<McpToolOutcome>;
}

/** Who is calling: the key's agent name and what it may do ("*" = everything). */
export interface McpCaller {
  agent: string;
  scopes: readonly string[];
  /** env = the master or Hermes key; minted = a public.agent_keys row. */
  kind: "env" | "minted";
}

/**
 * What a tool handler gets. The heavy dependencies (the Operator's
 * executors, in-process routes, the brand shelf) come in through here, so
 * the handlers stay framework-free and `node --test` runs them against
 * fakes. The route builds the real one (src/lib/mcp/context.ts).
 */
export interface McpToolContext {
  supabase: AdminClient;
  caller: McpCaller;
  /** This deployment's origin. */
  origin: string;
  /** The agent_runs row auditing this call, or null when it could not be written. */
  runId: string | null;
  /** How the caller is named on rows it writes: `agent:<name>`. */
  actor: string;
  /** Runs one of the Operator's read executors (src/lib/agent/tools.ts). */
  operator: (
    name: "get_lead" | "list_pipeline" | "get_content_calendar",
    input: Record<string, unknown>,
  ) => Promise<McpToolOutcome>;
  /** GETs one of this app's routes in-process, as a signed master request. */
  route: (name: "home", query?: Record<string, string>) => Promise<unknown>;
  /** The Brand Playbook shelf (src/lib/brand/playbook-store.ts). */
  loadBrandPlaybooks: () => Promise<
    ReadonlyArray<{ slug: string; playbook: unknown }>
  >;
}

export type McpHandler = McpTool<McpToolContext>["handler"];
/** Handlers by tool name; ./tools/index.ts joins them to the catalog. */
export type McpHandlers = Record<string, McpHandler>;
