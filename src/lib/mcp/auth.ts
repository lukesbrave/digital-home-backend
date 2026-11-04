/**
 * POST /api/mcp's bearer auth, wired to the real env and public.agent_keys.
 * The rules live in ./caller.ts, which the tests drive.
 */
import { verifyAgentKey } from "@/lib/api/agent-keys";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveMcpCaller, type McpAuthResult } from "./caller";

export function authenticateMcpToken(
  token: string | null,
): Promise<McpAuthResult> {
  return resolveMcpCaller(token, process.env, (plaintext) =>
    verifyAgentKey(createAdminClient(), plaintext),
  );
}
