/**
 * /api/mcp — the Home's open door: a standard Model Context Protocol server
 * any agent can connect to (Claude Code, Codex, Buzz), with a curated,
 * scoped tool belt. See MCP.md.
 *
 * This file only adapts Next's request and response: the HTTP behaviour is
 * handleMcpHttp (src/lib/mcp/server.ts), auth is src/lib/mcp/caller.ts, and
 * the tools are src/lib/mcp/tools. Every executed tool call is audited as an
 * agent_runs row naming the agent (src/lib/mcp/context.ts).
 *
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateMcpToken } from "@/lib/mcp/auth";
import {
  buildToolContext,
  closeAuditRun,
  secretRedactor,
} from "@/lib/mcp/context";
import { handleMcpHttp } from "@/lib/mcp/server";
import { MCP_TOOLS } from "@/lib/mcp/tools";
import type { McpToolContext } from "@/lib/mcp/types";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function respond(request: NextRequest) {
  const out = await handleMcpHttp<McpToolContext>(
    {
      method: request.method,
      header: (name) => request.headers.get(name),
      text: () => request.text(),
    },
    {
      tools: MCP_TOOLS,
      authenticate: authenticateMcpToken,
      serve: (caller, token) => {
        const supabase = createAdminClient();
        return {
          createContext: (tool) =>
            buildToolContext(
              supabase,
              caller,
              request.nextUrl.origin,
              tool.name,
            ),
          audit: (record, ctx) => closeAuditRun(supabase, ctx, record),
          redact: secretRedactor(token),
        };
      },
    },
  );
  if (out.body === null)
    return new NextResponse(null, { status: out.status, headers: out.headers });
  return NextResponse.json(out.body, {
    status: out.status,
    headers: out.headers,
  });
}

export const GET = respond;
export const POST = respond;
export const PUT = respond;
export const PATCH = respond;
export const DELETE = respond;
