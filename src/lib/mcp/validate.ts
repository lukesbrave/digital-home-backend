/**
 * A small JSON Schema validator for MCP tool arguments. Covers what the tool
 * belt's schemas use: type (one or a list), required, properties,
 * additionalProperties: false, enum, minimum/maximum, minLength/maxLength,
 * minItems/maxItems and items. Anything else in a schema is ignored.
 *
 * Pure, so `node --test` imports it directly.
 */

export type JsonSchemaType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "object"
  | "array"
  | "null";

export interface JsonSchema {
  type?: JsonSchemaType | JsonSchemaType[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  enum?: readonly (string | number | boolean | null)[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  items?: JsonSchema;
  default?: unknown;
}

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function typeOf(value: unknown): JsonSchemaType | "undefined" {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number")
    return Number.isInteger(value) ? "integer" : "number";
  if (
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "object"
  ) {
    return typeof value as JsonSchemaType;
  }
  return "undefined";
}

function matchesType(value: unknown, wanted: JsonSchemaType): boolean {
  const actual = typeOf(value);
  return actual === wanted || (wanted === "number" && actual === "integer");
}

/** Every way `value` breaks `schema`, as "path: problem" lines. Empty = valid. */
export function validateJson(
  schema: JsonSchema,
  value: unknown,
  path = "arguments",
): string[] {
  const errors: string[] = [];

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(value, t))) {
      errors.push(
        `${path}: expected ${types.join(" or ")}, got ${typeOf(value)}`,
      );
      return errors;
    }
  }

  if (
    schema.enum &&
    !schema.enum.includes(value as string | number | boolean | null)
  ) {
    errors.push(
      `${path}: must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(", ")}`,
    );
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum)
      errors.push(`${path}: must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum)
      errors.push(`${path}: must be <= ${schema.maximum}`);
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${path}: must be at least ${schema.minLength} characters`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${path}: must be at most ${schema.maxLength} characters`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path}: needs at least ${schema.minItems} item(s)`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${path}: takes at most ${schema.maxItems} item(s)`);
    }
    if (schema.items) {
      value.forEach((item, i) =>
        errors.push(
          ...validateJson(schema.items as JsonSchema, item, `${path}[${i}]`),
        ),
      );
    }
  }

  if (typeOf(value) === "object") {
    const record = value as Record<string, unknown>;
    // Own keys only on both sides: "constructor" or "__proto__" must not
    // find Object.prototype and slip past additionalProperties: false.
    for (const key of schema.required || []) {
      if (!hasOwn(record, key) || record[key] === undefined)
        errors.push(`${path}.${key}: is required`);
    }
    const properties = schema.properties || {};
    for (const [key, child] of Object.entries(record)) {
      if (child === undefined) continue;
      if (hasOwn(properties, key)) {
        errors.push(...validateJson(properties[key], child, `${path}.${key}`));
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}.${key}: is not a known argument`);
      }
    }
  }

  return errors;
}
