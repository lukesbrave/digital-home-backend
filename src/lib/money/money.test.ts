import assert from "node:assert/strict";
import test from "node:test";
import {
  formatMinor,
  isValidAmountMinor,
  lineTotal,
  minorUnitDigits,
  normalizeCurrency,
  parseMajorToMinor,
  stripeCurrency,
  toMajor,
} from "./money.ts";

test("formatting minor units by currency", () => {
  assert.equal(formatMinor(4900, "AUD"), "$49");
  assert.equal(formatMinor(4999, "AUD"), "$49.99");
  assert.equal(formatMinor(4900, "AUD", { exact: true }), "$49.00");
  assert.match(formatMinor(4900, "USD"), /^USD\s49$/u); // en-AU spells out other dollars
  assert.equal(formatMinor(4900, "USD", { locale: "en-US" }), "$49");
  assert.equal(formatMinor(123456, "EUR", { locale: "en-US", exact: true }), "€1,234.56");
  assert.equal(formatMinor(4900, "JPY", { locale: "en-US" }), "¥4,900"); // zero-decimal: 4900 is ¥4,900
  assert.match(formatMinor(1500, "KWD", { locale: "en-US", exact: true }), /^KWD\s1\.500$/u); // three-decimal
  assert.equal(formatMinor(0, "AUD"), "$0");
  assert.equal(formatMinor(4900, "aud"), "$49"); // lower case from Stripe
});

test("an ISO-shaped code Intl does not know still formats", () => {
  assert.equal(formatMinor(1234, "XQZ"), formatMinor(1234, "XQZ")); // stable, no throw
  assert.match(formatMinor(1234, "XQZ", { exact: true }), /12\.34/);
});

test("currency codes normalise to upper case, Stripe gets lower", () => {
  assert.equal(normalizeCurrency(" aud "), "AUD");
  assert.equal(normalizeCurrency("AUDD"), null);
  assert.equal(normalizeCurrency("A1D"), null);
  assert.equal(normalizeCurrency(36), null);
  assert.equal(stripeCurrency("AUD"), "aud");
  assert.equal(minorUnitDigits("jpy"), 0);
  assert.equal(minorUnitDigits("BHD"), 3);
  assert.equal(minorUnitDigits("AUD"), 2);
  assert.equal(toMajor(4999, "AUD"), 49.99);
  assert.equal(toMajor(4999, "JPY"), 4999);
});

test("major-unit input parses to minor units without float drift", () => {
  assert.equal(parseMajorToMinor("49.99", "AUD"), 4999);
  assert.equal(parseMajorToMinor("49.9", "AUD"), 4990);
  assert.equal(parseMajorToMinor("49", "AUD"), 4900);
  assert.equal(parseMajorToMinor(0.3, "AUD"), 30);
  assert.equal(parseMajorToMinor("1000", "JPY"), 1000);
  assert.equal(parseMajorToMinor("10.5", "JPY"), null); // JPY has no decimals
  assert.equal(parseMajorToMinor("1.234", "KWD"), 1234);
  assert.equal(parseMajorToMinor("49.999", "AUD"), null);
  assert.equal(parseMajorToMinor("-5", "AUD"), null);
  assert.equal(parseMajorToMinor("abc", "AUD"), null);
  assert.equal(parseMajorToMinor("1000000", "AUD"), null); // over Stripe's 8-digit ceiling
});

test("amounts are whole, non-negative and within Stripe's ceiling", () => {
  assert.equal(isValidAmountMinor(0), true);
  assert.equal(isValidAmountMinor(99_999_999), true);
  assert.equal(isValidAmountMinor(100_000_000), false);
  assert.equal(isValidAmountMinor(-1), false);
  assert.equal(isValidAmountMinor(10.5), false);
  assert.equal(isValidAmountMinor("100"), false);
  assert.equal(lineTotal([{ quantity: 2, amount_minor: 1500 }, { quantity: 1, amount_minor: 250 }]), 3250);
  assert.equal(lineTotal([{ quantity: 0, amount_minor: 1500 }]), null);
  assert.equal(lineTotal([{ quantity: 2, amount_minor: 60_000_000 }]), null);
});

test("the Home currency setting falls back to AUD, the CRM's own", async () => {
  const { currencyFromSetting, DEFAULT_CURRENCY } = await import("./money.ts");
  assert.equal(DEFAULT_CURRENCY, "AUD");
  assert.equal(currencyFromSetting("usd"), "USD");
  assert.equal(currencyFromSetting(null), "AUD");
  assert.equal(currencyFromSetting("dollars"), "AUD");
});
