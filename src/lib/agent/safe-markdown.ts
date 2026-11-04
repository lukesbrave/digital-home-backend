/**
 * Markdown to HTML for text the owner did not write: approvals-queue
 * descriptions and drafts filed by agents (src/app/agent/page.tsx).
 *
 * Allowlist by construction: only the tags marked itself emits survive.
 * - Raw HTML in the source (block or inline) is rendered as escaped text.
 * - A link keeps its href only for http(s)://, mailto: or a same-site path
 *   ("/x", "#x"); anything else (javascript:, data:, entity-encoded schemes)
 *   renders as its plain text.
 * - An image renders only from https://; otherwise its alt text.
 * Links and images are written here with every attribute escaped: marked
 * 16's own image renderer leaves alt unescaped (alt="a" onerror="x").
 *
 * `escapeMarkdownText` is the other end: agent text placed into a
 * description is escaped so it reads as literal text, never as markup.
 *
 * Framework-free, so `node --test` covers it (safe-markdown.test.ts).
 */

import { Marked, type Tokens } from "marked";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Agent text as literal markdown: no emphasis, links, headings, lists or HTML. */
export function escapeMarkdownText(text: string): string {
  return escapeHtml(text.replace(/[\\`*_{}[\]()#+\-.!|~]/g, "\\$&"));
}

/**
 * The literal prefix decides: an attribute is entity-decoded by the browser,
 * so "javascript&#58;..." must not pass as a relative path.
 */
export function isSafeHref(href: string): boolean {
  const url = href.replace(/^[\u0000- ]+/, "");
  if (/^(https?:\/\/|mailto:)/i.test(url)) return true;
  return /^[/#]/.test(url) && !url.startsWith("//") && !/[:&\\]/.test(url);
}

const safeMarked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html(token: Tokens.HTML | Tokens.Tag) {
      return escapeHtml(token.text);
    },
    link(token: Tokens.Link) {
      const inner = this.parser.parseInline(token.tokens);
      if (!isSafeHref(token.href)) return inner;
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
      return `<a href="${escapeHtml(token.href.trim())}"${title} rel="noopener noreferrer">${inner}</a>`;
    },
    image(token: Tokens.Image) {
      const href = token.href.trim();
      if (!/^https:\/\//i.test(href)) return escapeHtml(token.text);
      return `<img src="${escapeHtml(href)}" alt="${escapeHtml(token.text)}">`;
    },
  },
});

export function renderSafeMarkdown(md: string): string {
  return safeMarked.parse(md, { async: false }) as string;
}
