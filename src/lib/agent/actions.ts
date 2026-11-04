import { onDealWon } from "@/lib/money/engagements";
import { moneyDb } from "@/lib/money/db";
import { isDealWon } from "@/lib/money/state";
import type { AdminClient, Lead } from "@/lib/crm/types";
import type { Json } from "@/types/database";
import { sendCrmEmail } from "@/lib/crm/email";
import { logActivity } from "@/lib/crm/activity";
import { fireTrigger } from "@/lib/crm/engine";
import { socialPublishingEnabled } from "@/lib/social/feature";
import { executeAgentProposal } from "./proposals";
import { approvalEvent, recordHomeEvent } from "@/lib/events/record";
import type { HomeEventActor } from "@/lib/events/shape";
import { NextRequest } from "next/server";
import { POST as createSocialPost } from "@/app/api/social/posts/route";
import {
  buildSigningPayload,
  computeSignature,
  MASTER_AGENT,
  signingSecretFor,
} from "@/lib/api/signing";
import {
  decideAction,
  type AgentAction,
  type AgentActionDecision,
} from "./decision";
export { AgentActionDecisionError } from "./decision";
async function executeAgentAction(
  db: AdminClient,
  action: AgentAction,
): Promise<Json> {
  if (action.type === "email") {
    const p = action.payload as {
      lead_id: string;
      email: string;
      subject: string;
      body_md: string;
    };
    const { data: lead, error } = await db
      .from("leads")
      .select("*")
      .eq("id", p.lead_id)
      .single();
    if (error || !lead || lead.email !== p.email)
      throw new Error("Recipient changed; request a new proposal");
    const result = await sendCrmEmail(db, {
      lead: lead as Lead,
      subject: p.subject,
      bodyMd: p.body_md,
      actor: "approvals",
    });
    if (result.status === "failed")
      throw new Error(result.error || "Send failed");
    return result as unknown as Json;
  }
  if (action.type !== "other") throw new Error("Unsupported action type");
  const result = await executeAgentProposal(db, action, {
    logActivity,
    fireTrigger,
    afterPipelineMove: async (db, p) => {
      if (p.close_as === "won") {
        const { data: lead, error } = await db
          .from("leads")
          .update({ status: "converted" })
          .eq("id", p.lead_id)
          .select("*")
          .single();
        if (error || !lead)
          throw new Error(
            "Deal moved, but lead status could not be updated; review before retrying",
          );
        await fireTrigger(db, {
          type: "status_changed",
          lead,
          data: { status: "converted" },
        });
      }
      if (isDealWon({ status: p.close_as, stageName: p.to_stage }))
        await onDealWon(moneyDb(db), {
          opportunityId: p.opportunity_id,
          leadId: p.lead_id,
          actor: `agent:${p.proposed_by}`,
        });
    },
    createSocialDraft: async (input) => {
      if (!socialPublishingEnabled(process.env.SOCIAL_PUBLISHING_ENABLED))
        throw new Error(
          "Social calendar is disabled; activate it before approving social drafts",
        );
      const { data: accounts, error } = await db
        .from("social_accounts")
        .select("id,platform")
        .eq("status", "active");
      if (error) throw new Error("Cannot read social accounts");
      const platforms = input.platforms as string[] | undefined;
      const body = JSON.stringify({
        title: input.title,
        caption: input.caption,
        status: "draft",
        post_type: (input.media_urls as string[] | undefined)?.length
          ? "carousel"
          : "video",
        media: ((input.media_urls as string[]) || []).map((url) => ({
          url,
          kind: "image",
        })),
        account_ids: (accounts || [])
          .filter(
            (a) =>
              (!platforms?.length || platforms.includes(a.platform)) &&
              (!(input.media_urls as string[] | undefined)?.length ||
                a.platform !== "youtube"),
          )
          .map((a) => a.id),
      });
      const key = process.env.API_SECRET_KEY,
        secret = key ? signingSecretFor(MASTER_AGENT, key) : undefined;
      if (!key || !secret)
        throw new Error("Home signing configuration missing");
      const path = "/api/social/posts",
        ts = String(Math.floor(Date.now() / 1000));
      const response = await createSocialPost(
        new NextRequest("https://home.invalid" + path, {
          method: "POST",
          body,
          headers: {
            "content-type": "application/json",
            "x-api-key": key,
            "x-timestamp": ts,
            "x-signature": computeSignature(
              secret,
              buildSigningPayload("POST", path, ts, body),
            ),
          },
        }),
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Draft failed");
      return { data: { ...data, post_id: data.post?.id } };
    },
  });
  if (result === null) throw new Error("Unsupported proposal");
  return result;
}
export function decideAgentAction(
  db: AdminClient,
  id: string,
  decision: AgentActionDecision,
  actor: HomeEventActor,
) {
  return decideAction(
    db,
    id,
    decision,
    actor,
    executeAgentAction,
    async (action, event, who, result) => {
      await recordHomeEvent(db, approvalEvent(action, event, who, result));
    },
  );
}
