/** Draft fulfilment recipes. Owner only: admin session or signed master key. */
import { NextRequest, NextResponse } from "next/server";
import { authenticateSessionOrApiKey, requireScope, unauthorizedResponse } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { fulfilmentRecipeState, seedFulfilmentRecipes } from "@/lib/crm/fulfilment-seed";

export async function GET(request: NextRequest) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  const denied = requireScope(auth, "leads:write");
  if (denied) return denied;
  if (auth.mode === "api-key" && auth.agent !== "master") {
    return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  }
  try {
    return NextResponse.json({ recipes: await fulfilmentRecipeState(createAdminClient()) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Fulfilment state fetch failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  const denied = requireScope(auth, "leads:write");
  if (denied) return denied;
  if (auth.mode === "api-key" && auth.agent !== "master") {
    return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  if (!body || body.action !== "seed") {
    return NextResponse.json({ error: 'action must be "seed"' }, { status: 400 });
  }
  try {
    return NextResponse.json({ ok: true, ...await seedFulfilmentRecipes(createAdminClient()) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Fulfilment seed failed" }, { status: 500 });
  }
}
