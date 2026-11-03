import assert from "node:assert/strict";
import test from "node:test";
import { SCOPES } from "../../api/agent-key-scopes.ts";
import { validateJson, type JsonSchema } from "../validate.ts";
import { MCP_TOOL_SPECS } from "./catalog.ts";

const EXPECTED = [
  "home.info",
  "home.guide",
  "leads.search",
  "leads.get",
  "leads.timeline",
  "leads.add_note",
  "pipeline.list",
  "pipeline.move",
  "calendar.list",
  "article.propose",
  "social.propose",
  "brand.playbook.get",
  "approvals.list",
  "approvals.mine",
];

test("the belt is exactly the agreed tools, each named once", () => {
  assert.deepEqual(
    MCP_TOOL_SPECS.map((t) => t.name),
    EXPECTED,
  );
});

test("no tool is outward: sending, publishing, spending and deleting are proposals", () => {
  const outward = MCP_TOOL_SPECS.filter((t) => t.approval === "outward").map(
    (t) => t.name,
  );
  assert.deepEqual(outward, []);
  for (const name of ["pipeline.move", "article.propose", "social.propose"]) {
    assert.equal(
      MCP_TOOL_SPECS.find((t) => t.name === name)!.approval,
      "proposes",
      name,
    );
  }
});

test("every tool's scopes come from the key vocabulary, and proposals are never read-only", () => {
  for (const tool of MCP_TOOL_SPECS) {
    for (const scope of tool.scopes)
      assert.ok(
        (SCOPES as readonly string[]).includes(scope),
        `${tool.name}: ${scope}`,
      );
    if (tool.approval === "proposes")
      assert.equal(tool.readOnly, false, tool.name);
    assert.ok(
      tool.description.length > 40,
      `${tool.name} needs a real description`,
    );
    assert.ok(tool.title, `${tool.name} needs a title`);
  }
  const scopes = (name: string) =>
    MCP_TOOL_SPECS.find((t) => t.name === name)!.scopes;
  assert.deepEqual(scopes("pipeline.move"), [
    "approvals:propose",
    "leads:read",
  ]);
  // Open to any key: the Home's self-description and the caller's own proposals.
  assert.deepEqual(
    MCP_TOOL_SPECS.filter((t) => t.scopes.length === 0).map((t) => t.name),
    ["home.info", "home.guide", "approvals.mine"],
  );
  // Writes always need a scope.
  for (const tool of MCP_TOOL_SPECS.filter((t) => !t.readOnly))
    assert.ok(tool.scopes.length > 0, tool.name);
});

test("every schema is a closed object the validator fully understands", () => {
  const known = new Set([
    "type",
    "description",
    "properties",
    "required",
    "additionalProperties",
    "enum",
    "minimum",
    "maximum",
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
    "items",
    "default",
  ]);
  const walk = (schema: JsonSchema, path: string) => {
    for (const key of Object.keys(schema))
      assert.ok(known.has(key), `${path}: unsupported keyword ${key}`);
    assert.ok(schema.type, `${path}: needs a type`);
    for (const [name, child] of Object.entries(schema.properties || {}))
      walk(child, `${path}.${name}`);
    if (schema.items) walk(schema.items, `${path}[]`);
    for (const name of schema.required || [])
      assert.ok(schema.properties?.[name], `${path}: requires unknown ${name}`);
  };
  for (const tool of MCP_TOOL_SPECS) {
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
    walk(tool.inputSchema, tool.name);
  }
});

test("the validator: types, required, enum, bounds, lengths, items", () => {
  const schema: JsonSchema = {
    type: "object",
    properties: {
      n: { type: "integer", minimum: 1, maximum: 3 },
      x: { type: "number" },
      s: { type: "string", minLength: 2, maxLength: 4, enum: ["ab", "abc"] },
      list: {
        type: "array",
        minItems: 1,
        maxItems: 2,
        items: { type: "string", enum: ["a", "b"] },
      },
      flag: { type: ["boolean", "null"] },
    },
    required: ["n"],
    additionalProperties: false,
  };
  assert.deepEqual(
    validateJson(schema, { n: 2, x: 2, s: "ab", list: ["a"], flag: null }),
    [],
  );
  assert.deepEqual(validateJson(schema, { n: 2, x: 2.5 }), []);
  assert.deepEqual(validateJson(schema, {}), ["arguments.n: is required"]);
  assert.deepEqual(validateJson(schema, { n: 0 }), [
    "arguments.n: must be >= 1",
  ]);
  assert.deepEqual(validateJson(schema, { n: 4 }), [
    "arguments.n: must be <= 3",
  ]);
  assert.deepEqual(validateJson(schema, { n: "2" }), [
    "arguments.n: expected integer, got string",
  ]);
  assert.deepEqual(validateJson(schema, { n: 1, s: "abcde" }), [
    'arguments.s: must be one of "ab", "abc"',
    "arguments.s: must be at most 4 characters",
  ]);
  assert.deepEqual(validateJson(schema, { n: 1, list: [] }), [
    "arguments.list: needs at least 1 item(s)",
  ]);
  assert.deepEqual(validateJson(schema, { n: 1, list: ["a", "c", "b"] }), [
    "arguments.list: takes at most 2 item(s)",
    'arguments.list[1]: must be one of "a", "b"',
  ]);
  assert.deepEqual(validateJson(schema, { n: 1, flag: "yes" }), [
    "arguments.flag: expected boolean or null, got string",
  ]);
  assert.deepEqual(validateJson(schema, [1]), [
    "arguments: expected object, got array",
  ]);
});
