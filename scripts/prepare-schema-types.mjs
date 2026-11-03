#!/usr/bin/env node
import { readFileSync, writeFileSync, lstatSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { prepareSchemaTypes } from "./lib/schema-types.mjs";
const [generatedFile, backendFile, frontendFile, outputDirectory] =
  process.argv.slice(2);
if (!outputDirectory) {
  console.error(
    "Usage: node scripts/prepare-schema-types.mjs GENERATED BACKEND_TYPES FRONTEND_TYPES EMPTY_EXISTING_OUTPUT_DIR",
  );
  process.exit(1);
}
try {
  const inputs = [generatedFile, backendFile, frontendFile].map((p) => {
    if (!lstatSync(p).isFile() || lstatSync(p).isSymbolicLink())
      throw new Error("Inputs must be regular files");
    return { path: realpathSync(p), text: readFileSync(p, "utf8") };
  });
  if (
    !lstatSync(outputDirectory).isDirectory() ||
    lstatSync(outputDirectory).isSymbolicLink()
  )
    throw new Error("Output must be a real directory");
  const results = inputs
    .slice(1)
    .map((input) => prepareSchemaTypes(input.text, inputs[0].text));
  const report = {
    format: "schema_type_review_v1",
    generated_sha256: createHash("sha256").update(inputs[0].text).digest("hex"),
    inputs: inputs
      .slice(1)
      .map((i) => ({
        path: i.path,
        sha256: createHash("sha256").update(i.text).digest("hex"),
      })),
    backend: { removed: results[0].removed, added: results[0].added },
    frontend: { removed: results[1].removed, added: results[1].added },
    review_required: true,
  };
  for (const name of [
    "backend.database.ts",
    "frontend.database.ts",
    "review.json",
  ]) {
    const out = resolve(outputDirectory, name);
    if (inputs.some((i) => i.path === out))
      throw new Error("Output would overwrite input");
  }
  // wx refuses any pre-existing output. Partial output on an IO error is never applied.
  writeFileSync(
    resolve(outputDirectory, "review.json"),
    JSON.stringify(report, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  results.forEach((r, i) =>
    writeFileSync(
      resolve(
        outputDirectory,
        i ? "frontend.database.ts" : "backend.database.ts",
      ),
      r.candidate,
      { flag: "wx", mode: 0o600 },
    ),
  );
  console.log(
    "Review candidates created. Source files and database unchanged. Review removals and changed types, then typecheck both apps before adopting.",
  );
  if (results.some((r) => r.removed.length)) {
    console.error(
      "Schema members are missing from generated output. Adoption is blocked pending schema reconciliation.",
    );
    process.exitCode = 2;
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
