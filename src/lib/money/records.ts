/**
 * Money records — the vocabularies and input checks the routes share. Pure,
 * no framework imports.
 */

import type { DeliverableStatus, EngagementStage, EngagementStatus, ProductKind } from "../../types/database.ts";
import { isValidAmountMinor, normalizeCurrency, DEFAULT_CURRENCY } from "./money.ts";

export const PRODUCT_KINDS: readonly ProductKind[] = ["one_time", "subscription", "deposit", "invoice_item"];
export const ENGAGEMENT_STAGES: readonly EngagementStage[] = [
  "brief", "research", "copy", "design", "review", "build", "launch", "care", "closed",
];
export const ENGAGEMENT_STATUSES: readonly EngagementStatus[] = ["active", "paused", "won", "lost"];
export const DELIVERABLE_STATUSES: readonly DeliverableStatus[] = ["todo", "in_progress", "review", "done"];

/** Kinds a buyer can pay for at checkout; invoice_item only goes on invoices. */
export const CHECKOUT_KINDS: readonly ProductKind[] = ["one_time", "subscription", "deposit"];

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface ProductFields {
  slug: string;
  name: string;
  description: string | null;
  kind: ProductKind;
  amount_minor: number;
  currency: string;
  interval: "month" | "year" | null;
  active: boolean;
  stripe_product_id: string | null;
  stripe_price_id: string | null;
  metadata: Record<string, unknown>;
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Checks a product body. With `existing` (a PATCH) only the fields present
 * are checked and the result is merged over it, so the kind/interval rule is
 * judged on the product as it will be saved.
 */
export function checkProduct(
  body: Record<string, unknown>,
  existing?: ProductFields,
  opts: { defaultCurrency?: string } = {}
): Checked<ProductFields> {
  const has = (k: string) => k in body;
  const base: ProductFields = existing ?? {
    slug: "",
    name: "",
    description: null,
    kind: "one_time",
    amount_minor: 0,
    currency: opts.defaultCurrency || DEFAULT_CURRENCY,
    interval: null,
    active: true,
    stripe_product_id: null,
    stripe_price_id: null,
    metadata: {},
  };
  const next: ProductFields = { ...base };

  if (!existing || has("name")) {
    const name = optionalText(body.name);
    if (!name) return { ok: false, error: "name is required" };
    next.name = name.slice(0, 200);
  }
  if (!existing || has("slug")) {
    const slug = optionalText(body.slug) ?? (existing ? null : slugify(next.name));
    if (!slug || !SLUG_RE.test(slug)) return { ok: false, error: "slug must be lowercase letters, digits and dashes" };
    next.slug = slug;
  }
  if (!existing || has("kind")) {
    const kind = body.kind ?? "one_time";
    if (!PRODUCT_KINDS.includes(kind as ProductKind)) return { ok: false, error: `kind must be one of ${PRODUCT_KINDS.join(", ")}` };
    next.kind = kind as ProductKind;
  }
  if (!existing || has("amount_minor")) {
    if (!isValidAmountMinor(body.amount_minor)) {
      return { ok: false, error: "amount_minor must be a whole number of minor units (cents), 0 to 99,999,999" };
    }
    next.amount_minor = body.amount_minor;
  }
  if (!existing || has("currency")) {
    const currency = body.currency === undefined && !existing ? base.currency : normalizeCurrency(body.currency);
    if (!currency) return { ok: false, error: "currency must be a three-letter ISO code, e.g. AUD" };
    next.currency = currency;
  }
  if (has("interval")) {
    const interval = body.interval ?? null;
    if (interval !== null && interval !== "month" && interval !== "year") {
      return { ok: false, error: "interval must be month, year or null" };
    }
    next.interval = interval;
  }
  // A product that stops being a subscription loses its interval.
  if (next.kind !== "subscription" && !has("interval")) next.interval = null;
  if (next.kind === "subscription" && !next.interval) return { ok: false, error: "a subscription needs interval month or year" };
  if (next.kind !== "subscription" && next.interval) return { ok: false, error: "only a subscription has an interval" };

  if (has("description")) next.description = optionalText(body.description);
  if (has("active")) {
    if (typeof body.active !== "boolean") return { ok: false, error: "active must be true or false" };
    next.active = body.active;
  }
  if (has("stripe_product_id")) next.stripe_product_id = optionalText(body.stripe_product_id);
  if (has("stripe_price_id")) {
    const price = optionalText(body.stripe_price_id);
    if (price && !price.startsWith("price_")) return { ok: false, error: "stripe_price_id looks like price_…" };
    next.stripe_price_id = price;
  }
  if (has("metadata")) {
    if (!body.metadata || typeof body.metadata !== "object" || Array.isArray(body.metadata)) {
      return { ok: false, error: "metadata must be an object" };
    }
    next.metadata = body.metadata as Record<string, unknown>;
  }
  return { ok: true, value: next };
}

export interface LineInput {
  description: string;
  quantity: number;
  amount_minor: number;
  product_id: string | null;
}

/** Invoice lines: at least one, each with a description, a quantity ≥ 1 and a valid amount. */
export function checkLines(input: unknown): Checked<LineInput[]> {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, error: "items must be a non-empty array" };
  if (input.length > 100) return { ok: false, error: "at most 100 items" };
  const lines: LineInput[] = [];
  for (const [i, raw] of input.entries()) {
    const item = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const description = optionalText(item.description);
    if (!description) return { ok: false, error: `items[${i}].description is required` };
    const quantity = item.quantity === undefined ? 1 : item.quantity;
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > 10_000) {
      return { ok: false, error: `items[${i}].quantity must be a whole number from 1` };
    }
    if (!isValidAmountMinor(item.amount_minor)) return { ok: false, error: `items[${i}].amount_minor must be whole minor units` };
    lines.push({ description: description.slice(0, 500), quantity, amount_minor: item.amount_minor, product_id: optionalText(item.product_id) });
  }
  return { ok: true, value: lines };
}

/** INV-20261027-3F9A: the date plus four random hex, unique enough for one Home and readable on a call. */
export function newInvoiceNumber(now: Date = new Date(), random: string = Math.random().toString(16).slice(2, 6)): string {
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `INV-${ymd}-${random.toUpperCase().padStart(4, "0")}`;
}

/** An absolute http(s) URL, or null. Checkout's return URLs must be one. */
export function checkReturnUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** backend_settings.money_onboarding_workflow: a workflow id or name, or {id} / {name}. */
export const ONBOARDING_SETTING = "money_onboarding_workflow";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
