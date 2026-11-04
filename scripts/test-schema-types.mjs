import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareSchemaTypes } from "./lib/schema-types.mjs";
const schema = (extra) =>
  `export type Json=string|null; export type Database={ public:{Tables:{leads:{Row:{id:string;${extra}};Insert:{id?:string};Update:{id?:string}}};Views:{}} };`;
test("generated client columns survive and member aliases remain byte-for-byte", () => {
  const member =
    schema("custom:string;") +
    '\n// My type\nexport type VIP=Database["public"]["Tables"]["leads"]["Row"];';
  const r = prepareSchemaTypes(
    member,
    schema("custom:string; new_field:number|null;"),
  );
  assert.deepEqual(r.removed, []);
  assert.ok(r.candidate.includes("custom:string; new_field:number|null;"));
  assert.ok(
    r.candidate.endsWith(
      '// My type\nexport type VIP=Database["public"]["Tables"]["leads"]["Row"];',
    ),
  );
});
test("wrong project or incomplete generation reports lost custom columns", () => {
  assert.ok(
    prepareSchemaTypes(schema("custom:string;"), schema("")).removed.includes(
      "public.Tables.leads.Row.custom",
    ),
  );
});
test("rejects malformed or partial type output", () => {
  for (const s of [
    "oops",
    "export type Database={",
    "export type Database={private:{}};export type Json=string;",
  ])
    assert.throws(() => prepareSchemaTypes(schema(""), s));
});
