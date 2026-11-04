/**
 * The Stripe webhook, start to finish, with the database passed in. No
 * framework imports: the route hands it a Supabase-backed store
 * (./apply.ts), the tests hand it an in-memory one.
 *
 *   verify signature → record the event (one row per event id) → claim it
 *   → plan → apply → finish (or release the claim with the error, so Stripe's
 *   redelivery applies it again)
 *
 * The claim is what makes concurrent deliveries safe: only one delivery of an
 * event applies it at a time. A delivery that finds the event claimed answers
 * 409, not 2xx, so Stripe keeps retrying it in case the claimant fails.
 */

import { verifyStripeSignature, type SignatureFailure } from "./stripe-signature.ts";
import { isTestModeEvent, planStripeEvent, type MoneyPlan, type StripeEventLike } from "./state.ts";

export interface WebhookStore {
  /** Insert the event keyed by its provider id. "duplicate" when that id was already processed. */
  recordEvent(event: StripeEventLike, rawPayload: unknown): Promise<"recorded" | "duplicate">;
  /** Atomically take the event for this delivery. False when another delivery holds it. */
  claimEvent(eventId: string): Promise<boolean>;
  /** Processed: stamps processed_at and stores what was done. */
  finishEvent(eventId: string, result: ApplyResult): Promise<void>;
  /** Failed: drops the claim and keeps the error, leaving the event unprocessed. */
  releaseEvent(eventId: string, error: string): Promise<void>;
  applyPlan(plan: MoneyPlan, event: StripeEventLike): Promise<ApplyResult>;
}

export interface ApplyResult {
  /** What changed, for the response, payment_events.result and the logs. */
  summary: string;
  orderId?: string | null;
  invoiceId?: string | null;
  leadId?: string | null;
  onboarding?: { enrolled: boolean; reason?: string } | null;
  ignored?: string;
}

export type WebhookOutcome =
  | { status: 503; body: { error: string } }
  | { status: 400; body: { error: string; reason?: SignatureFailure } }
  | { status: 409; body: { error: string } }
  | { status: 200; body: { received: true; duplicate?: true; ignored?: string; result?: ApplyResult } }
  | { status: 500; body: { error: string } };

const SIGNATURE_MESSAGES: Record<SignatureFailure, string> = {
  no_secret: "Stripe is not configured",
  missing_header: "Missing Stripe-Signature header",
  malformed_header: "Malformed Stripe-Signature header",
  stale: "Stripe-Signature timestamp is outside the tolerance",
  mismatch: "Stripe-Signature does not match",
};

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function handleStripeWebhook(
  input: {
    rawBody: string;
    signatureHeader: string | null;
    secret: string | null | undefined;
    nowSeconds?: number;
    /** Apply test-mode events to the CRM (see acceptsTestEvents in ./stripe-client.ts). */
    allowTestEvents?: boolean;
  },
  store: WebhookStore
): Promise<WebhookOutcome> {
  if (!input.secret) return { status: 503, body: { error: SIGNATURE_MESSAGES.no_secret } };

  const check = verifyStripeSignature({
    payload: input.rawBody,
    header: input.signatureHeader,
    secret: input.secret,
    nowSeconds: input.nowSeconds,
  });
  if (!check.ok) return { status: 400, body: { error: SIGNATURE_MESSAGES[check.reason], reason: check.reason } };

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.rawBody);
  } catch {
    return { status: 400, body: { error: "Body is not JSON" } };
  }
  const event = parsed as StripeEventLike;
  if (!event || typeof event.id !== "string" || typeof event.type !== "string") {
    return { status: 400, body: { error: "Not a Stripe event" } };
  }

  // Recorded before anything is decided about it, so every signed delivery
  // leaves a row; a failure to record is a 500 and Stripe tries again.
  let recorded: "recorded" | "duplicate";
  let claimed: boolean;
  try {
    recorded = await store.recordEvent(event, parsed);
    if (recorded === "duplicate") return { status: 200, body: { received: true, duplicate: true } };
    claimed = await store.claimEvent(event.id);
  } catch (e) {
    return { status: 500, body: { error: `Could not record ${event.type}: ${message(e)}` } };
  }
  if (!claimed) return { status: 409, body: { error: `${event.id} is being applied by another delivery` } };

  const plan: MoneyPlan =
    isTestModeEvent(event) && !input.allowTestEvents
      ? { kind: "ignore", reason: "test-mode event on a live Home (set STRIPE_ALLOW_TEST_EVENTS=true to apply them)" }
      : planStripeEvent(event);

  try {
    const result = plan.kind === "ignore" ? { summary: "ignored", ignored: plan.reason } : await store.applyPlan(plan, event);
    await store.finishEvent(event.id, result);
    return plan.kind === "ignore"
      ? { status: 200, body: { received: true, ignored: plan.reason } }
      : { status: 200, body: { received: true, result } };
  } catch (e) {
    // Left unprocessed with the error recorded: a 500 makes Stripe redeliver,
    // and the redelivery claims and applies it again.
    await store.releaseEvent(event.id, message(e)).catch(() => {});
    return { status: 500, body: { error: `Could not apply ${event.type}: ${message(e)}` } };
  }
}
