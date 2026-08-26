import { NextRequest, NextResponse } from "next/server";
import { authenticateSessionOrApiKey, unauthorizedResponse } from "@/lib/api/auth";
import {
  assertBrandPublisherReady,
  getBrandOperationalReadiness,
  inspectBrandProjection,
  loadBrandPlaybooks,
  publishBrandPlaybook,
  validatePlaybook,
  type StoredPlaybookEnvelope,
} from "@/lib/brand/playbook-store";
import type { Playbook } from "../../../../../brand/playbooks";

function cleanActor(value: unknown): string {
  if (typeof value !== "string") return "master";
  return value.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40) || "master";
}

export async function GET(request: NextRequest) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);

  try {
    await assertBrandPublisherReady();
    const playbooks = await loadBrandPlaybooks();
    const current = playbooks[0] || null;
    const [projection, operational] = await Promise.all([
      current ? inspectBrandProjection(current.playbook) : Promise.resolve({ ready: false, fingerprint: "", rows: 0, missing: [], stale: [] }),
      getBrandOperationalReadiness(),
    ]);
    return NextResponse.json({
      ready: true,
      current,
      projection,
      operational,
      playbooks: playbooks.map(({ slug, playbook }) => ({ slug, meta: playbook.meta })),
    });
  } catch (error) {
    return NextResponse.json(
      { ready: false, error: error instanceof Error ? error.message : "Brand shelf is not ready" },
      { status: 503 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);

  let body: { playbook?: unknown; actor?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }

  const errors = validatePlaybook(body.playbook);
  if (errors.length > 0) {
    return NextResponse.json({ error: "Invalid Brand Playbook", details: errors }, { status: 400 });
  }

  const publishedBy = auth.mode === "session"
    ? `user:${auth.userId}`
    : `agent:${cleanActor(body.actor || auth.agent)}`;

  try {
    const result = await publishBrandPlaybook(body.playbook as Playbook, publishedBy);
    return NextResponse.json({
      success: true,
      changed: result.changed,
      archivedSlug: result.archivedSlug || null,
      current: result.current as StoredPlaybookEnvelope,
      projection: result.projection,
      brandPath: "/brand/current",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Brand Playbook publish failed" },
      { status: 500 }
    );
  }
}
