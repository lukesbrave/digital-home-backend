/** brand.playbook.get: the Brand Playbook shelf. */
import type { McpHandlers } from "../types.ts";
import { str } from "./shared.ts";

export const brandHandlers: McpHandlers = {
  async "brand.playbook.get"(args, ctx) {
    const slug = str(args.slug) || "current";
    const entries = await ctx.loadBrandPlaybooks();
    const available = entries.map((entry) => entry.slug);
    const entry = entries.find((e) => e.slug === slug);
    if (!entry)
      throw new Error(
        `No playbook "${slug}"; available: ${available.join(", ") || "none"}`,
      );
    return {
      data: { slug, playbook: entry.playbook, available },
      summary: `Read the brand playbook (${slug})`,
    };
  },
};
