import { NextRequest, NextResponse } from "next/server";
import { authenticateSession, unauthorizedResponse } from "@/lib/api/auth";
import { isMoneyReady, keyLivemode } from "@/lib/money/stripe-client";
import { socialPublishingEnabled } from "@/lib/social/feature";
export async function GET(request: NextRequest) {
  const auth = await authenticateSession(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  return NextResponse.json(
    {
      social: {
        enabled: socialPublishingEnabled(process.env.SOCIAL_PUBLISHING_ENABLED),
      },
      email: { configured: !!process.env.RESEND_API_KEY },
      payments: {
        configured: isMoneyReady(process.env),
        test_mode: keyLivemode(process.env) === false,
      },
      studio: { bundled: false },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
