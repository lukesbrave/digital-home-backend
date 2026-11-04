import assert from "node:assert/strict";
import test from "node:test";
import {
  escapeMarkdownText,
  isSafeHref,
  renderSafeMarkdown,
} from "./safe-markdown.ts";

/** Every tag in the HTML as its name and its real attributes (quoted values parsed whole). */
function tags(
  html: string,
): { name: string; attrs: Array<[string, string]> }[] {
  return [
    ...html.matchAll(
      /<([a-z][a-z0-9]*)((?:\s+[^\s=>]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/gi,
    ),
  ].map((m) => ({
    name: m[1].toLowerCase(),
    attrs: [...m[2].matchAll(/([^\s=>]+)(?:=("[^"]*"|'[^']*'|[^\s>]+))?/g)].map(
      (a) =>
        [a[1].toLowerCase(), (a[2] || "").replace(/^["']|["']$/g, "")] as [
          string,
          string,
        ],
    ),
  }));
}

/** No tag outside marked's own vocabulary, no attribute outside a small set, no unsafe URL. */
function assertInert(html: string) {
  const allowedTags = new Set([
    "p",
    "br",
    "strong",
    "em",
    "a",
    "code",
    "pre",
    "ul",
    "ol",
    "li",
    "blockquote",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "del",
    "img",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
  ]);
  const allowedAttrs = new Set([
    "href",
    "title",
    "rel",
    "src",
    "alt",
    "align",
    "start",
    "class",
  ]);
  for (const tag of tags(html)) {
    assert.ok(allowedTags.has(tag.name), `unexpected <${tag.name}> in ${html}`);
    for (const [name, value] of tag.attrs) {
      assert.ok(
        allowedAttrs.has(name),
        `attribute ${name} on <${tag.name}> in ${html}`,
      );
      if (name === "href" || name === "src") {
        assert.match(
          value,
          /^(https?:\/\/|mailto:|\/(?!\/)|#)/i,
          `unsafe URL ${value}`,
        );
      }
    }
  }
}

test("raw HTML from anyone renders as text, not elements", () => {
  for (const md of [
    '<img src=x onerror="alert(1)">',
    "<script>alert(1)</script>",
    'Hello <a href="javascript:alert(1)">there</a>',
    "<div onclick=alert(1)>block</div>\n\nafter",
    "<svg><script>alert(1)</script></svg>",
  ]) {
    const html = renderSafeMarkdown(md);
    assertInert(html);
    assert.ok(!/<(img|script|div|svg)\b/i.test(html), html);
  }
  assert.match(
    renderSafeMarkdown('<img src=x onerror="alert(1)">'),
    /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/,
  );
});

test("links keep only safe hrefs; unsafe ones become their text", () => {
  assert.equal(
    renderSafeMarkdown("[ok](https://example.com/a?b=1&c=2)"),
    '<p><a href="https://example.com/a?b=1&amp;c=2" rel="noopener noreferrer">ok</a></p>\n',
  );
  for (const md of [
    "[x](javascript:alert(1))",
    "[x](JaVaScRiPt:alert(1))",
    "[x]( javascript:alert(1))",
    "[x](javascript&#58;alert(1))",
    "[x](data:text/html,<script>alert(1)</script>)",
    "<javascript:alert(1)>",
    "[x][r]\n\n[r]: javascript:alert(1)",
    "[x](//evil.example.com)",
    "![x](javascript:alert(1))",
    "![x](http://tracker.example.com/p.gif)",
  ]) {
    const html = renderSafeMarkdown(md);
    assertInert(html);
    assert.doesNotMatch(html, /href=|src=/, `${md} -> ${html}`);
  }
  assert.match(
    renderSafeMarkdown("![logo](https://cdn.example.com/l.png)"),
    /<img src="https:\/\/cdn\.example\.com\/l\.png" alt="logo">/,
  );
});

test("attributes cannot be broken out of: alt, title and href are escaped", () => {
  for (const md of [
    '![a" onerror="alert(1)](https://cdn.example.com/i.png)',
    '[x](https://a.b "t\\" onmouseover=\\"alert(1)")',
    '[x](<https://a.b/" onmouseover="alert(1)>)',
  ]) {
    const html = renderSafeMarkdown(md);
    assertInert(html);
  }
});

test("isSafeHref", () => {
  for (const ok of [
    "https://a.b",
    "http://a.b",
    "mailto:a@b.co",
    "/crm/leads/1",
    "#top",
  ])
    assert.equal(isSafeHref(ok), true, ok);
  for (const bad of [
    "javascript:x",
    "data:x",
    "//evil",
    "/x:y",
    "/a&#58;b",
    "vbscript:x",
    "relative/path",
    "",
  ]) {
    assert.equal(isSafeHref(bad), false, bad);
  }
});

test("escaped agent text reads literally: no markup, links or HTML survive", () => {
  const evil =
    'Big news <img src=x onerror="alert(1)"> and [click](javascript:alert(1)) **now** # heading\n> quote\n1. list';
  const html = renderSafeMarkdown(escapeMarkdownText(evil));
  assertInert(html);
  assert.doesNotMatch(html, /<(img|a|strong|h1|blockquote|ol)\b/);
  assert.match(
    html,
    /\[click\]\(javascript:alert\(1\)\)/,
    "the text is still there to read",
  );
  assert.match(html, /\*\*now\*\*/);
});
