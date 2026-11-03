/**
 * An in-memory stand-in for the Supabase query builder, for `node --test`.
 * Covers what the MCP handlers and agent proposals use: select / insert /
 * update / delete, eq, neq, in, gt/gte/lt/lte, contains, ilike (% and _
 * wildcards, backslash escapes), order, limit, single and maybeSingle. `or`
 * is recorded but does not filter.
 *
 * Every call is recorded in `ops`, so a test can assert what was (and was
 * not) written. Unique columns per table turn a clash into a 23505 error.
 * Test-only: nothing in the app imports it.
 */

type Row = Record<string, unknown>;

export interface FakeOp {
  table: string;
  op: "select" | "insert" | "update" | "delete";
  values?: unknown;
  filters: string[];
}

export interface FakeOptions {
  /** table → column sets that must be unique (each set is one constraint). */
  unique?: Record<string, string[][]>;
  /** table → defaults applied to inserted rows. */
  defaults?: Record<string, Row>;
}

let sequence = 0;

export function fakeUuid(): string {
  sequence += 1;
  return `00000000-0000-4000-8000-${sequence.toString(16).padStart(12, "0")}`;
}

function contains(container: unknown, wanted: unknown): boolean {
  if (Array.isArray(wanted)) {
    return (
      Array.isArray(container) &&
      wanted.every((w) => container.some((c) => contains(c, w)))
    );
  }
  if (wanted && typeof wanted === "object") {
    if (!container || typeof container !== "object") return false;
    return Object.entries(wanted).every(([k, v]) =>
      contains((container as Row)[k], v),
    );
  }
  return container === wanted;
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  return (a as number | string) < (b as number | string) ? -1 : 1;
}

class FakeQuery
  implements
    PromiseLike<{
      data: unknown;
      error: { code?: string; message: string } | null;
    }>
{
  private op: FakeOp["op"] = "select";
  private values: unknown;
  private returning = false;
  private filters: Array<(row: Row) => boolean> = [];
  private described: string[] = [];
  private orders: Array<[string, boolean]> = [];
  private max: number | null = null;
  private mode: "many" | "single" | "maybe" = "many";

  private readonly db: FakeSupabase;
  private readonly table: string;

  constructor(db: FakeSupabase, table: string) {
    this.db = db;
    this.table = table;
  }

  private where(label: string, test: (row: Row) => boolean) {
    this.filters.push(test);
    this.described.push(label);
    return this;
  }

  select(columns?: string) {
    void columns;
    if (this.op !== "select") this.returning = true;
    return this;
  }
  insert(values: unknown) {
    this.op = "insert";
    this.values = values;
    return this;
  }
  update(values: unknown) {
    this.op = "update";
    this.values = values;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(column: string, value: unknown) {
    return this.where(
      `${column}=${String(value)}`,
      (row) => row[column] === value,
    );
  }
  neq(column: string, value: unknown) {
    return this.where(
      `${column}!=${String(value)}`,
      (row) => row[column] !== value,
    );
  }
  in(column: string, values: unknown[]) {
    return this.where(`${column} in`, (row) => values.includes(row[column]));
  }
  gt(column: string, value: unknown) {
    return this.where(
      `${column}>${String(value)}`,
      (row) => compare(row[column], value) > 0,
    );
  }
  gte(column: string, value: unknown) {
    return this.where(
      `${column}>=${String(value)}`,
      (row) => compare(row[column], value) >= 0,
    );
  }
  lt(column: string, value: unknown) {
    return this.where(
      `${column}<${String(value)}`,
      (row) => compare(row[column], value) < 0,
    );
  }
  lte(column: string, value: unknown) {
    return this.where(
      `${column}<=${String(value)}`,
      (row) => compare(row[column], value) <= 0,
    );
  }
  contains(column: string, value: unknown) {
    return this.where(`${column} @> ${JSON.stringify(value)}`, (row) =>
      contains(row[column], value),
    );
  }
  or(expression: string) {
    this.described.push(`or(${expression})`);
    return this;
  }
  ilike(column: string, pattern: string) {
    const source = pattern.replace(
      /\\(.)|([%_])|([^\\%_]+)/g,
      (_m, escaped: string, wild: string, plain: string) =>
        escaped !== undefined
          ? escaped.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          : wild !== undefined
            ? wild === "%"
              ? ".*"
              : "."
            : plain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    );
    const re = new RegExp(`^${source}$`, "is");
    return this.where(
      `${column} ilike ${pattern}`,
      (row) =>
        typeof row[column] === "string" && re.test(row[column] as string),
    );
  }
  order(column: string, options: { ascending?: boolean } = {}) {
    this.orders.push([column, options.ascending !== false]);
    return this;
  }
  limit(count: number) {
    this.max = count;
    return this;
  }
  range(from: number, to: number) {
    this.max = to - from + 1;
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    return this;
  }

  then<
    A = { data: unknown; error: { code?: string; message: string } | null },
    B = never,
  >(
    resolve?:
      | ((value: {
          data: unknown;
          error: { code?: string; message: string } | null;
        }) => A | PromiseLike<A>)
      | null,
    reject?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve()
      .then(() => this.run())
      .then(resolve, reject);
  }

  private shape(rows: Row[]) {
    const copies = rows.map((row) => structuredClone(row));
    if (this.mode === "many") return { data: copies, error: null };
    if (copies.length > 1)
      return {
        data: null,
        error: { code: "PGRST116", message: "more than one row" },
      };
    if (this.mode === "single" && copies.length === 0) {
      return { data: null, error: { code: "PGRST116", message: "no rows" } };
    }
    return { data: copies[0] ?? null, error: null };
  }

  private run() {
    const rows = (this.db.tables[this.table] ||= []);
    const matches = () =>
      rows.filter((row) => this.filters.every((test) => test(row)));
    this.db.ops.push({
      table: this.table,
      op: this.op,
      values: this.values,
      filters: this.described,
    });

    if (this.op === "select") {
      let found = matches();
      for (const [column, ascending] of [...this.orders].reverse()) {
        found = [...found].sort(
          (a, b) => compare(a[column], b[column]) * (ascending ? 1 : -1),
        );
      }
      if (this.max !== null) found = found.slice(0, this.max);
      return this.shape(found);
    }

    if (this.op === "insert") {
      const incoming = (
        Array.isArray(this.values) ? this.values : [this.values]
      ) as Row[];
      const inserted: Row[] = [];
      for (const values of incoming) {
        const row: Row = {
          id: fakeUuid(),
          created_at: new Date(
            Date.UTC(2026, 9, 26, 8, 0, rows.length + inserted.length),
          ).toISOString(),
          ...(this.db.options.defaults?.[this.table] || {}),
          ...values,
        };
        for (const columns of this.db.options.unique?.[this.table] || []) {
          if (
            [...rows, ...inserted].some((other) =>
              columns.every((c) => other[c] === row[c]),
            )
          ) {
            return {
              data: null,
              error: {
                code: "23505",
                message: `duplicate key on ${columns.join(", ")}`,
              },
            };
          }
        }
        inserted.push(row);
      }
      rows.push(...inserted);
      return this.returning
        ? this.shape(inserted)
        : { data: null, error: null };
    }

    if (this.op === "update") {
      const found = matches();
      for (const row of found) Object.assign(row, this.values);
      return this.returning ? this.shape(found) : { data: null, error: null };
    }

    const found = matches();
    this.db.tables[this.table] = rows.filter((row) => !found.includes(row));
    return this.returning ? this.shape(found) : { data: null, error: null };
  }
}

export class FakeSupabase {
  readonly ops: FakeOp[] = [];
  tables: Record<string, Row[]>;
  readonly options: FakeOptions;

  constructor(tables: Record<string, Row[]> = {}, options: FakeOptions = {}) {
    this.tables = tables;
    this.options = options;
  }

  from(table: string) {
    return new FakeQuery(this, table);
  }

  /** Every insert, update and delete, in order. */
  writes(): FakeOp[] {
    return this.ops.filter((op) => op.op !== "select");
  }
}
