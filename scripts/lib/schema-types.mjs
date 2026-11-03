import ts from "typescript";
function parse(text) {
  const file = ts.createSourceFile(
    "database.ts",
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  if (file.parseDiagnostics.length)
    throw new Error("Invalid generated TypeScript");
  return file;
}
function alias(file, name) {
  return file.statements.find(
    (s) => ts.isTypeAliasDeclaration(s) && s.name.text === name,
  );
}
function members(node) {
  return ts.isTypeLiteralNode(node) ? node.members : [];
}
function prop(node, key) {
  return members(node).find(
    (m) => m.name?.getText().replace(/^['"]|['"]$/g, "") === key,
  )?.type;
}
function paths(node, prefix = "", out = new Set()) {
  for (const m of members(node)) {
    const name = m.name?.getText().replace(/^['"]|['"]$/g, "");
    if (!name) continue;
    const path = prefix ? prefix + "." + name : name;
    out.add(path);
    paths(m.type, path, out);
  }
  return out;
}
// Replace only Database + Json from actual schema output. Keep the member's
// helpers, aliases and imports byte-for-byte. No database or source file writes.
export function prepareSchemaTypes(existing, generated) {
  const old = parse(existing),
    fresh = parse(generated),
    db = alias(fresh, "Database"),
    json = alias(fresh, "Json");
  if (!db || !json || !prop(db.type, "public"))
    throw new Error("Expected complete generated Database and Json types");
  const previous = alias(old, "Database");
  if (!previous) throw new Error("Existing Database alias missing");
  const before = paths(previous.type),
    after = paths(db.type);
  const removed = [...before].filter((p) => !after.has(p));
  const replacements = ["Database", "Json"]
    .map((name) => {
      const prior = alias(old, name),
        next = alias(fresh, name);
      if (!prior) throw new Error("Existing " + name + " alias missing");
      return {
        start: prior.getStart(old),
        end: prior.end,
        text: next.getText(fresh),
      };
    })
    .sort((a, b) => b.start - a.start);
  let candidate = existing;
  for (const change of replacements)
    candidate =
      candidate.slice(0, change.start) +
      change.text +
      candidate.slice(change.end);
  return {
    candidate,
    removed,
    added: [...after].filter((p) => !before.has(p)),
  };
}
