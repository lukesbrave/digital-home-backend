/**
 * Stripe webhook signatures — pure, no Stripe SDK.
 *
 * Stripe signs each delivery with the endpoint's signing secret (whsec_…):
 *
 *   Stripe-Signature: t=1730000000,v1=<hex hmac>,v1=<hex hmac>,v0=…
 *
 * where each v1 is HMAC-SHA256(secret, `${t}.${rawBody}`). More than one v1
 * appears while a secret is being rolled. v0 is a test-mode leftover and is
 * ignored. The body must be the raw bytes Stripe sent: re-serialised JSON
 * will not match.
 */

import { createHmac, timingSafeEqual } from "crypto";

/** Stripe's own default: a delivery older than five minutes is refused. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

export type SignatureFailure = "no_secret" | "missing_header" | "malformed_header" | "stale" | "mismatch";

export type SignatureCheck = { ok: true; timestamp: number } | { ok: false; reason: SignatureFailure };

export function parseSignatureHeader(header: string): { timestamp: number | null; signatures: string[] } {
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t" && /^\d+$/.test(value)) timestamp = Number(value);
    else if (key === "v1" && /^[0-9a-f]{64}$/i.test(value)) signatures.push(value.toLowerCase());
  }
  return { timestamp, signatures };
}

export function computeSignature(secret: string, timestamp: number, payload: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${payload}`, "utf8").digest("hex");
}

function sameHex(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyStripeSignature(input: {
  payload: string;
  header: string | null | undefined;
  secret: string | null | undefined;
  toleranceSeconds?: number;
  /** Seconds since the epoch; tests pass a fixed clock. */
  nowSeconds?: number;
}): SignatureCheck {
  if (!input.secret) return { ok: false, reason: "no_secret" };
  if (!input.header) return { ok: false, reason: "missing_header" };

  const { timestamp, signatures } = parseSignatureHeader(input.header);
  if (timestamp === null || signatures.length === 0) return { ok: false, reason: "malformed_header" };

  const tolerance = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (tolerance > 0 && Math.abs(now - timestamp) > tolerance) return { ok: false, reason: "stale" };

  const expected = computeSignature(input.secret, timestamp, input.payload);
  if (!signatures.some((s) => sameHex(s, expected))) return { ok: false, reason: "mismatch" };
  return { ok: true, timestamp };
}

/** A header the way Stripe would send it. For tests and fabricated local deliveries only. */
export function signPayload(secret: string, payload: string, timestamp: number): string {
  return `t=${timestamp},v1=${computeSignature(secret, timestamp, payload)}`;
}
