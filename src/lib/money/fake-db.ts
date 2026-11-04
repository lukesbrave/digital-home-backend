/**
 * An in-memory stand-in for the Supabase client, for the money tests only.
 * It speaks the slice of the query builder the money code uses (select,
 * insert, update, delete; eq, is, lt, in, ilike, order, limit, range,
 * maybeSingle, single), enforces the unique columns of the migration
 * (answering code 23505 like Postgres), and can be told to fail a table's
 * reads or writes to prove errors are not swallowed.
 */

import { randomUUID } from "crypto";

type Row = Record<string, unknown>;
type Op = "select" | "insert" | "update" | "delete";
type Result = { data: unknown; error: { message: string; code?: string } | null; count?: number | null };

/** Unique columns per table, as in 20261027040000_money.sql. */
const UNIQUE: Record<string, string[]> = {
  payment_events: ["provider_event_id"],
  orders: ["stripe_checkout_session_id", "stripe_payment_intent_id", "stripe_subscription_id"],
  products: ["slug"],
  invoices: ["number", "stripe_invoice_id"],
  engagements: ["opportunity_id"],
  leads: ["email"],
  backend_settings: ["key"],
};

export interface FakeDb {
  tables: Record<string, Row[]>;
  /** Every call, for assertions: `${op} ${table}`. */
  calls: string[];
  /** Return an error for matching calls while this says so. */
  failWhen: ((table: string, op: Op) => boolean) | null;
  /** Runs before each call; a test uses it to change rows mid-flight (another delivery racing). */
  beforeCall: ((table: string, op: Op) => void) | null;
  from(table: string): Builder;
  rows(table: string): Row[];
}

function read(row: Row, column: string): unknown {
  const json = column.match(/^(\w+)->>(\w+)$/);
  if (json) {
    const v = (row[json[1]] as Row | null)?.[json[2]];
    return v === undefined || v === null ? null : String(v);
  }
  return row[column];
}

function likeToRegex(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\" && i + 1 < pattern.length) out += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    else if (c === "%") out += ".*";
    else if (c === "_") out += ".";
    else out += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`, "i");
}

class Builder implements PromiseLike<Result> {
  private op: Op = "select";
  private payload: Row | Row[] | null = null;
  private filters: Array<(r: Row) => boolean> = [];
  private sorts: Array<{ col: string; asc: boolean }> = [];
  private lim: number | null = null;
  private rng: [number, number] | null = null;
  private returning = false;
  private head = false;
  private counting = false;
  private mode: "many" | "maybe" | "single" = "many";

  private db: FakeDb;
  private table: string;

  constructor(db: FakeDb, table: string) {
    this.db = db;
    this.table = table;
  }

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.op !== "select") this.returning = true;
    if (opts?.head) this.head = true;
    if (opts?.count) this.counting = true;
    return this;
  }
  insert(rows: Row | Row[]) {
    this.op = "insert";
    this.payload = rows;
    return this;
  }
  update(patch: Row) {
    this.op = "update";
    this.payload = patch;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(col: string, v: unknown) {
    // backend_settings.value is jsonb; PostgREST filters use JSON literals.
    if (this.table === "backend_settings" && col === "value" && typeof v === "string") v = JSON.parse(v);
    this.filters.push((r) => Array.isArray(v)
      ? JSON.stringify(read(r, col)) === JSON.stringify(v)
      : read(r, col) === v);
    return this;
  }
  is(col: string, v: null) {
    this.filters.push((r) => (read(r, col) ?? null) === v);
    return this;
  }
  lt(col: string, v: string | number) {
    this.filters.push((r) => {
      const x = read(r, col);
      return x !== null && x !== undefined && (x as string | number) < v;
    });
    return this;
  }
  in(col: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(read(r, col)));
    return this;
  }
  ilike(col: string, pattern: string) {
    const re = likeToRegex(pattern);
    this.filters.push((r) => typeof read(r, col) === "string" && re.test(read(r, col) as string));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.sorts.push({ col, asc: opts?.ascending !== false });
    return this;
  }
  limit(n: number) {
    this.lim = n;
    return this;
  }
  range(from: number, to: number) {
    this.rng = [from, to];
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }

  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve(this.run()).then(ok, bad);
  }

  private matching(): Row[] {
    return this.db.rows(this.table).filter((r) => this.filters.every((f) => f(r)));
  }

  private shape(rows: Row[]): Result {
    let out = rows.map((r) => structuredClone(r));
    for (const s of [...this.sorts].reverse()) {
      out.sort((a, b) => {
        const x = a[s.col] as string | number, y = b[s.col] as string | number;
        return (x < y ? -1 : x > y ? 1 : 0) * (s.asc ? 1 : -1);
      });
    }
    if (this.rng) out = out.slice(this.rng[0], this.rng[1] + 1);
    if (this.lim !== null) out = out.slice(0, this.lim);
    if (this.mode === "maybe") {
      if (out.length > 1) return { data: null, error: { message: "multiple rows", code: "PGRST116" } };
      return { data: out[0] ?? null, error: null };
    }
    if (this.mode === "single") {
      return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { message: "not one row", code: "PGRST116" } };
    }
    return { data: this.head ? null : out, error: null, count: this.counting ? rows.length : null };
  }

  private clash(candidate: Row, ignore?: Row): string | null {
    for (const col of UNIQUE[this.table] || []) {
      const v = candidate[col];
      if (v === null || v === undefined) continue;
      if (this.db.rows(this.table).some((r) => r !== ignore && r[col] === v)) return col;
    }
    return null;
  }

  private run(): Result {
    this.db.calls.push(`${this.op} ${this.table}`);
    this.db.beforeCall?.(this.table, this.op);
    if (this.db.failWhen?.(this.table, this.op)) return { data: null, error: { message: `injected ${this.op} failure on ${this.table}` } };
    const now = new Date().toISOString();

    if (this.op === "select") return this.shape(this.matching());

    if (this.op === "insert") {
      const incoming = (Array.isArray(this.payload) ? this.payload : [this.payload!]).map((r) => ({
        id: randomUUID(),
        created_at: now,
        updated_at: now,
        metadata: {},
        ...(this.table === "leads" ? { tags: [], status: "new" } : {}),
        ...r,
      }));
      for (const r of incoming) {
        const col = this.clash(r);
        if (col) return { data: null, error: { message: `duplicate key on ${this.table}.${col}`, code: "23505" } };
      }
      this.db.rows(this.table).push(...incoming);
      return this.returning ? this.shape(incoming) : { data: null, error: null };
    }

    const hit = this.matching();
    if (this.op === "update") {
      for (const r of hit) {
        const next = { ...r, ...this.payload, updated_at: now };
        const col = this.clash(next, r);
        if (col) return { data: null, error: { message: `duplicate key on ${this.table}.${col}`, code: "23505" } };
      }
      for (const r of hit) Object.assign(r, this.payload, { updated_at: now });
      return this.returning ? this.shape(hit) : { data: null, error: null };
    }

    const all = this.db.rows(this.table);
    this.db.tables[this.table] = all.filter((r) => !hit.includes(r));
    return { data: null, error: null };
  }
}

export function fakeDb(seed: Record<string, Row[]> = {}): FakeDb {
  const db: FakeDb = {
    tables: structuredClone(seed),
    calls: [],
    failWhen: null,
    beforeCall: null,
    from: (table) => new Builder(db, table),
    rows: (table) => (db.tables[table] ||= []),
  };
  return db;
}
