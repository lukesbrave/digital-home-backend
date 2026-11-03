/** home.info and home.guide: the Home describing itself. */
import { HOME_GUIDE } from "../../home/contract.ts";
import type { McpHandlers } from "../types.ts";

export const homeHandlers: McpHandlers = {
  // GET /api/home assembles the contract from env, the build manifest and
  // settings; call it rather than restate it.
  async "home.info"(_args, ctx) {
    const home = (await ctx.route("home")) as { version?: string | null };
    return {
      data: home,
      summary: `Read home_contract (version ${home.version ?? "unknown"})`,
    };
  },

  async "home.guide"() {
    const guide = HOME_GUIDE;
    return {
      data: guide,
      summary: `Read the route guide (${guide.routes.length} routes)`,
    };
  },
};
