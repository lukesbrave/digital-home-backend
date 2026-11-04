/**
 * GET|POST|DELETE /api/settings/agent-keys — the owner mints and revokes
 * per-agent API keys (AGENT-KEYS.md).
 *
 *   GET                              every key, newest first; never the hash
 *   POST {name, scopes, note?}       mint; the plaintext comes back ONCE
 *   DELETE ?id=<uuid> | ?name=<n>    revoke the active key
 *
 * Owner only: an admin session or the master key. A minted key, however
 * scoped, cannot mint another, and neither can an env-var agent key.
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateSessionOrApiKey, unauthorizedResponse, type AuthResult } from "@/lib/api/auth";
import { AgentKeyError, listAgentKeys, mintAgentKey, revokeAgentKey } from "@/lib/api/agent-keys";
import { MASTER_AGENT } from "@/lib/api/signing";
import { createAdminClient } from "@/lib/supabase/server";
import { actorFromLabel, agentKeyEvent, recordHomeEvent } from "@/lib/events/record";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

async function owner(request: NextRequest): Promise<{ actor: string } | Response> {
  const auth: AuthResult = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  if (auth.mode === "api-key" && auth.agent !== MASTER_AGENT) {
    return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  }
  return { actor: auth.mode === "session" ? `user:${auth.userId}` : MASTER_AGENT };
}

function failure(e: unknown) {
  if (e instanceof AgentKeyError) return NextResponse.json({ error: e.message }, { status: e.status });
  return NextResponse.json({ error: "Agent keys unavailable" }, { status: 503 });
}

export async function GET(request: NextRequest) {
  const who = await owner(request);
  if (who instanceof Response) return who;
  try {
    const keys = await listAgentKeys(createAdminClient());
    return NextResponse.json({ ok: true, keys }, { headers: NO_STORE });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(request: NextRequest) {
  const who = await owner(request);
  if (who instanceof Response) return who;

  let body: { name?: unknown; scopes?: unknown; note?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send JSON: {name, scopes, note?}" }, { status: 400 });
  }

  try {
    const key = await mintAgentKey(createAdminClient(), {
      name: body.name,
      scopes: body.scopes,
      note: body.note,
      createdBy: who.actor,
    });
    await recordHomeEvent(createAdminClient(), agentKeyEvent(actorFromLabel(who.actor), "key.minted", key));
    return NextResponse.json(
      { ok: true, key, warning: "This is the only time the key is shown. Store it now; it cannot be recovered." },
      { status: 201, headers: NO_STORE }
    );
  } catch (e) {
    return failure(e);
  }
}

export async function DELETE(request: NextRequest) {
  const who = await owner(request);
  if (who instanceof Response) return who;
  const params = request.nextUrl.searchParams;
  try {
    const revoked = await revokeAgentKey(createAdminClient(), {
      id: params.get("id")?.trim() || undefined,
      name: params.get("name")?.trim() || undefined,
    });
    if (!revoked) return NextResponse.json({ error: "No active key matches" }, { status: 404 });
    await recordHomeEvent(createAdminClient(), agentKeyEvent(actorFromLabel(who.actor), "key.revoked", revoked));
    return NextResponse.json({ ok: true, revoked }, { headers: NO_STORE });
  } catch (e) {
    return failure(e);
  }
}
