/**
 * Money amounts — the pure half. No framework imports, so `node --test` can
 * load it and the dashboard can share it.
 *
 * Every amount in the Home is an integer in the currency's minor unit, the
 * way Stripe counts: 4900 is A$49.00, 4900 JPY is ¥4,900. Currencies are
 * stored as upper-case ISO 4217 codes; Stripe wants them lower case.
 */

/** Stripe's zero-decimal currencies: the amount IS the major unit. */
const ZERO_DECIMAL = new Set([
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);

/** Stripe's three-decimal currencies. */
const THREE_DECIMAL = new Set(["BHD", "JOD", "KWD", "OMR", "TND"]);

/** Stripe's ceiling for a single amount (8 digits). */
export const MAX_AMOUNT_MINOR = 99_999_999;

/**
 * The currency when nothing else names one. The CRM already prices deals and
 * formats money in AUD (components/crm/kit.tsx fmtMoney), so money follows it;
 * a Home in another currency sets backend_settings.money_currency (see
 * currencyFromSetting below and MONEY.md).
 */
export const DEFAULT_CURRENCY = "AUD";

/** The key a Home sets to price in its own currency, e.g. "USD". */
export const CURRENCY_SETTING = "money_currency";

/** backend_settings.money_currency → an ISO code, else DEFAULT_CURRENCY. */
export function currencyFromSetting(value: unknown): string {
  return normalizeCurrency(value) || DEFAULT_CURRENCY;
}

/** "aud", " AUD " → "AUD"; anything that is not three letters → null. */
export function normalizeCurrency(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const code = input.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

/** The lower-case code Stripe's API takes. */
export function stripeCurrency(currency: string): string {
  return currency.trim().toLowerCase();
}

export function minorUnitDigits(currency: string): number {
  const code = currency.toUpperCase();
  if (ZERO_DECIMAL.has(code)) return 0;
  if (THREE_DECIMAL.has(code)) return 3;
  return 2;
}

export function isValidAmountMinor(amount: unknown): amount is number {
  return typeof amount === "number" && Number.isInteger(amount) && amount >= 0 && amount <= MAX_AMOUNT_MINOR;
}

/** 4999 AUD → 49.99 */
export function toMajor(amountMinor: number, currency: string): number {
  return amountMinor / 10 ** minorUnitDigits(currency);
}

/**
 * "49.99" or 49.99 in AUD → 4999. Null when the value has more decimals than
 * the currency allows, is negative, or is not a number. Done on the string so
 * 0.1 + 0.2 never becomes 30000000000000004.
 */
export function parseMajorToMinor(value: unknown, currency: string): number | null {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  const digits = minorUnitDigits(currency);
  const fraction = match[2] || "";
  if (fraction.length > digits) return null;
  const minor = Number(match[1]) * 10 ** digits + Number(fraction.padEnd(digits, "0") || "0");
  return isValidAmountMinor(minor) ? minor : null;
}

/**
 * 4999, "AUD" → "A$49.99" (en-AU). Whole amounts drop the decimals ("A$49")
 * unless `exact` is set, which the invoice and order lists use.
 */
export function formatMinor(
  amountMinor: number,
  currency: string,
  opts: { locale?: string; exact?: boolean } = {}
): string {
  const code = normalizeCurrency(currency) || DEFAULT_CURRENCY;
  const digits = minorUnitDigits(code);
  const major = toMajor(amountMinor || 0, code);
  const whole = Number.isInteger(major);
  const fractionDigits = opts.exact || !whole ? digits : 0;
  try {
    return new Intl.NumberFormat(opts.locale || "en-AU", {
      style: "currency",
      currency: code,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(major);
  } catch {
    // An ISO-shaped code Intl does not know (e.g. "XXY"): still readable.
    return `${major.toFixed(fractionDigits)} ${code}`;
  }
}

/** Sum of quantity × unit amount, or null if any line is invalid or it overflows Stripe's ceiling. */
export function lineTotal(lines: Array<{ quantity: number; amount_minor: number }>): number | null {
  let total = 0;
  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || !isValidAmountMinor(line.amount_minor)) return null;
    total += line.quantity * line.amount_minor;
  }
  return isValidAmountMinor(total) ? total : null;
}
