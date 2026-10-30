/**
 * Small helpers the money routes share. Each handler does its own auth, the
 * house way: authenticateSessionOrApiKey, then requireScope with money:read
 * (reads) or money:write (writes).
 */
import type { NextRequest } from "next/server";
import type { AuthResult } from "@/lib/api/auth";
import { NOT_CONFIGURED, type StripeResult } from "./stripe-client";

/** Who did it, for activity rows: "human" for the owner, "agent:<name>" for a key. */
export function actorOf(auth: Extract<AuthResult, { authenticated: true }>): string {
  return auth.mode === "session" ? "human" : `agent:${auth.agent}`;
}

/** A failed Stripe call as a response: 503 when Stripe is not configured, Stripe's own status otherwise. */
export function stripeFailure(result: Extract<StripeResult<unknown>, { ok: false }>): Response {
  return Response.json({ error: result.error }, { status: result.error === NOT_CONFIGURED ? 503 : result.status });
}

export async function readJson(request: NextRequest): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}
