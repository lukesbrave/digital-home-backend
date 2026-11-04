import assert from "node:assert/strict";
import test from "node:test";
import { checkLines, checkProduct, checkReturnUrl, newInvoiceNumber, slugify } from "./records.ts";

test("a product needs a name, a valid amount and a three-letter currency; the slug follows the name", () => {
  const ok = checkProduct({ name: "Brand Strategy Session", amount_minor: 49000, currency: "aud" });
  assert.equal(ok.ok, true);
  if (!ok.ok) return;
  assert.equal(ok.value.slug, "brand-strategy-session");
  assert.equal(ok.value.currency, "AUD");
  assert.equal(ok.value.kind, "one_time");
  assert.equal(checkProduct({ amount_minor: 1, currency: "AUD" }).ok, false);
  assert.equal(checkProduct({ name: "X", amount_minor: 10.5, currency: "AUD" }).ok, false);
  assert.equal(checkProduct({ name: "X", amount_minor: 100, currency: "dollars" }).ok, false);
  assert.equal(checkProduct({ name: "X", amount_minor: 100, currency: "AUD", kind: "gift" }).ok, false);
  assert.equal(checkProduct({ name: "X", slug: "Not A Slug", amount_minor: 100, currency: "AUD" }).ok, false);
  assert.equal(checkProduct({ name: "X", amount_minor: 100, currency: "AUD", stripe_price_id: "prod_1" }).ok, false);
});

test("only a subscription has an interval, and it must", () => {
  assert.equal(checkProduct({ name: "Club", amount_minor: 9900, currency: "AUD", kind: "subscription" }).ok, false);
  assert.equal(checkProduct({ name: "Club", amount_minor: 9900, currency: "AUD", kind: "subscription", interval: "month" }).ok, true);
  assert.equal(checkProduct({ name: "Club", amount_minor: 9900, currency: "AUD", kind: "one_time", interval: "month" }).ok, false);
  assert.equal(checkProduct({ name: "Club", amount_minor: 9900, currency: "AUD", kind: "subscription", interval: "week" }).ok, false);
});

test("a patch is judged on the product as it will be saved", () => {
  const base = checkProduct({ name: "Club", amount_minor: 9900, currency: "AUD", kind: "subscription", interval: "year" });
  assert.ok(base.ok);
  if (!base.ok) return;
  const cheaper = checkProduct({ amount_minor: 4900 }, base.value);
  assert.equal(cheaper.ok && cheaper.value.interval, "year");
  const oneOff = checkProduct({ kind: "one_time" }, base.value);
  assert.equal(oneOff.ok && oneOff.value.interval, null);
  assert.equal(checkProduct({ active: "yes" }, base.value).ok, false);
  const hidden = checkProduct({ active: false }, base.value);
  assert.equal(hidden.ok && hidden.value.slug, "club");
});

test("invoice lines", () => {
  const ok = checkLines([{ description: "Strategy", amount_minor: 300000 }, { description: "Workshop", quantity: 2, amount_minor: 50000 }]);
  assert.equal(ok.ok && ok.value[0].quantity, 1);
  assert.equal(checkLines([]).ok, false);
  assert.equal(checkLines("nope").ok, false);
  assert.equal(checkLines([{ amount_minor: 100 }]).ok, false);
  assert.equal(checkLines([{ description: "x", quantity: 0, amount_minor: 100 }]).ok, false);
  assert.equal(checkLines([{ description: "x", amount_minor: -1 }]).ok, false);
});

test("invoice numbers, slugs and return URLs", () => {
  assert.equal(newInvoiceNumber(new Date("2026-10-27T03:00:00Z"), "3f9a"), "INV-20261027-3F9A");
  assert.match(newInvoiceNumber(), /^INV-\d{8}-[0-9A-F]{4}$/);
  assert.equal(slugify("Café Brand — Deep Dive!"), "cafe-brand-deep-dive");
  assert.equal(checkReturnUrl("https://example.com/thanks?x=1"), "https://example.com/thanks?x=1");
  assert.equal(checkReturnUrl("/thanks"), null);
  assert.equal(checkReturnUrl("javascript:alert(1)"), null);
});

test("a product without a currency takes the Home's", () => {
  const home = checkProduct({ name: "Session", amount_minor: 100 }, undefined, { defaultCurrency: "NZD" });
  assert.equal(home.ok && home.value.currency, "NZD");
  const fallback = checkProduct({ name: "Session", amount_minor: 100 });
  assert.equal(fallback.ok && fallback.value.currency, "AUD");
});
