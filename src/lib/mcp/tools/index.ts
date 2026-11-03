/**
 * The MCP tool belt: the catalog (./catalog.ts) joined to its handlers. A
 * catalog entry without a handler, or a handler without an entry, fails at
 * import, so the build and the tests catch it. Framework-free: the handlers
 * get their heavy dependencies through McpToolContext.
 */
import type { McpHandlers, McpTool, McpToolContext } from "../types.ts";
import { approvalHandlers } from "./approvals.ts";
import { brandHandlers } from "./brand.ts";
import { MCP_TOOL_SPECS } from "./catalog.ts";
import { contentHandlers } from "./content.ts";
import { homeHandlers } from "./home.ts";
import { leadHandlers } from "./leads.ts";
import { pipelineHandlers } from "./pipeline.ts";

const HANDLERS: McpHandlers = {
  ...homeHandlers,
  ...leadHandlers,
  ...pipelineHandlers,
  ...contentHandlers,
  ...brandHandlers,
  ...approvalHandlers,
};

for (const name of Object.keys(HANDLERS)) {
  if (!MCP_TOOL_SPECS.some((spec) => spec.name === name))
    throw new Error(`MCP handler ${name} has no catalog entry`);
}

export const MCP_TOOLS: readonly McpTool<McpToolContext>[] = MCP_TOOL_SPECS.map(
  (spec) => {
    const handler = HANDLERS[spec.name];
    if (!handler) throw new Error(`MCP tool ${spec.name} has no handler`);
    return { ...spec, handler };
  },
);
