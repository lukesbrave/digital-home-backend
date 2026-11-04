/**
 * POST /api/webhooks/stripe — Stripe's deliveries for the member's own account.
 *
 * Signed with STRIPE_WEBHOOK_SECRET (the endpoint's whsec_…), recorded and
 * claimed once per event id in payment_events, then applied: orders and
 * invoices move, the buyer becomes a `customer` lead, and the
 * money_onboarding_workflow enrols them. Test-mode events reach the CRM only
 * on a Home running test keys or with STRIPE_ALLOW_TEST_EVENTS=true. See
 * MONEY.md for the events to subscribe.
 */
import { NextRequest, NextResponse } from "next/server";
import { handleStripeWebhook, type WebhookStore } from "@/lib/money/webhook";
import { createWebhookStore } from "@/lib/money/apply";
import { crmDeps } from "@/lib/money/crm-deps";
import { moneyDb } from "@/lib/money/db";
import { acceptsTestEvents } from "@/lib/money/stripe-client";

export async function POST(request: NextRequest) {
  // The raw body: the signature is over Stripe's exact bytes.
  const rawBody = await request.text();
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim() || null;
  const outcome = await handleStripeWebhook(
    {
      rawBody,
      signatureHeader: request.headers.get("stripe-signature"),
      secret,
      allowTestEvents: acceptsTestEvents(),
    },
    // Only built once there is a secret; without one the handler answers 503 first.
    secret ? createWebhookStore(moneyDb(), crmDeps) : unconfiguredStore
  );
  if (outcome.status === 500) console.error("stripe webhook:", outcome.body.error);
  return NextResponse.json(outcome.body, { status: outcome.status });
}

const unconfiguredStore: WebhookStore = {
  recordEvent: async () => "duplicate",
  claimEvent: async () => false,
  finishEvent: async () => {},
  releaseEvent: async () => {},
  applyPlan: async () => ({ summary: "not configured" }),
};
