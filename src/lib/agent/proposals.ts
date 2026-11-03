/**
 * Agent proposals: what an agent asks the owner to approve, filed into the
 * approvals queue (agent_actions, type 'other', payload.kind below) and run
 * only when the owner approves. POST /api/mcp files them (pipeline.move,
 * article.propose, social.propose); executeAgentAction in ./actions.ts runs
 * them on approval. They render as Approve/Reject decisions, never as FYIs
 * (./decision-kinds.ts).
 *
 * Both halves refuse rather than guess:
 * - filing refuses a second pending proposal for the same deal, keyword or
 *   caption;
 * - approving a deal move refuses when the deal moved or closed since it was
 *   proposed (the row ends 'failed' with the reason, and nothing changes).
 *
 * Framework-free (relative imports, side effects injected) so `node --test`
 * drives it with a fake client: src/lib/agent/proposals.test.ts.
 */

import type { ActivityInput } from "../crm/activity.ts";
import type { AdminClient, Lead } from "../crm/types.ts";
import type { Json } from "@/types/database";
import { agentProposalKind } from "./decision-kinds.ts";
import { escapeMarkdownText as lit } from "./safe-markdown.ts";

/** Who filed a proposal. */
export interface Proposer {
  agent: string;
  runId: string | null;
}

interface ProposalBase {
  proposed_by: string;
  via: "mcp";
  reason: string | null;
  /**
   * Markdown the dashboard shows under Preview: a fixed template, with every
   * piece of agent-supplied (or CRM) text passed through `lit` so it reads as
   * literal text, never as markup. The dashboard renders it safely as well.
   */
  description: string;
}

export interface PipelineMovePayload extends ProposalBase {
  kind: "pipeline_move";
  opportunity_id: string;
  opportunity_name: string;
  lead_id: string;
  from_stage_id: string;
  from_stage: string | null;
  to_stage_id: string | null;
  to_stage: string | null;
  to_pipeline_id: string | null;
  close_as: "won" | "lost" | null;
  lost_reason: string | null;
}

export interface ArticleTopicPayload extends ProposalBase {
  kind: "article_topic";
  title: string;
  target_keyword: string;
  /** Lowercased keyword, for the duplicate check. */
  keyword_key: string;
  keyword_cluster: string | null;
  pillar_topic: string | null;
  priority: "high" | "medium" | "low";
  notes: string | null;
}

export interface SocialDraftPayload extends ProposalBase {
  kind: "social_draft";
  caption: string;
  title: string | null;
  media_urls: string[];
  platforms: string[];
}

/** A refusal the caller should read: nothing was filed or changed. */
export class ProposalRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProposalRefused";
  }
}

export interface FiledProposal {
  action_id: string;
  status: string;
  title: string;
  note: string;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "")
    : [];
}

/** A pending proposal whose payload contains `match`, or null. */
export async function findPendingProposal(
  supabase: AdminClient,
  match: Record<string, string>,
): Promise<{ id: string; title: string } | null> {
  const { data, error } = await supabase
    .from("agent_actions")
    .select("id, title")
    .eq("status", "proposed")
    .contains("payload", match)
    .limit(1);
  if (error) throw new Error(error.message);
  return data?.[0] ?? null;
}

async function queue(
  supabase: AdminClient,
  proposer: Proposer,
  title: string,
  payload: PipelineMovePayload | ArticleTopicPayload | SocialDraftPayload,
  note: string,
): Promise<FiledProposal> {
  const { data, error } = await supabase
    .from("agent_actions")
    .insert({
      run_id: proposer.runId,
      type: "other",
      title,
      summary: payload.reason || `Proposed by ${proposer.agent} over MCP`,
      payload: payload as unknown as Json,
    })
    .select("id, status")
    .single();
  if (error || !data)
    throw new Error(
      `Could not queue the proposal: ${error?.message || "no row returned"}`,
    );
  return { action_id: data.id, status: data.status, title, note };
}

const QUEUED =
  "Queued for the owner's yes or no; approvals.mine shows the decision and the result.";

/**
 * A calendar entry with this keyword, ignoring case, or null. The table's
 * unique index is exact, so "Digital Home" and "digital home" would both fit.
 */
export async function calendarEntryForKeyword(
  supabase: AdminClient,
  keyword: string,
): Promise<{ id: string; title: string; status: string } | null> {
  let query = supabase
    .from("content_calendar")
    .select("id, title, status")
    .limit(1);
  // PostgREST reads * as a wildcard in like patterns and it cannot be escaped; such a keyword is matched exactly.
  query = keyword.includes("*")
    ? query.eq("target_keyword", keyword)
    : query.ilike("target_keyword", keyword.replace(/[\\%_]/g, "\\$&"));
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data?.[0] ?? null;
}

// ── filing ──────────────────────────────────────────────────────────────────

export async function proposePipelineMove(
  supabase: AdminClient,
  args: Record<string, unknown>,
  proposer: Proposer,
): Promise<FiledProposal> {
  const stageName = text(args.stage);
  const closeAs = text(args.close_as);
  if (!stageName && !closeAs)
    throw new ProposalRefused("Pass stage, or close_as won or lost");
  if (stageName && closeAs)
    throw new ProposalRefused("Pass stage or close_as, not both");
  if (closeAs && closeAs !== "won" && closeAs !== "lost")
    throw new ProposalRefused("close_as is won or lost");

  let query = supabase
    .from("opportunities")
    .select("id, name, lead_id, stage_id")
    .eq("status", "open");
  const opportunityId = text(args.opportunity_id);
  if (opportunityId) {
    query = query.eq("id", opportunityId);
  } else {
    const email = text(args.email).toLowerCase();
    if (!email)
      throw new ProposalRefused("Pass opportunity_id or the lead's email");
    const { data: lead, error } = await supabase
      .from("leads")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!lead) throw new ProposalRefused(`No lead found for ${email}`);
    query = query.eq("lead_id", lead.id);
  }
  const { data: deals, error } = await query.limit(1);
  if (error) throw new Error(error.message);
  const deal = deals?.[0];
  if (!deal)
    throw new ProposalRefused(
      "No open deal found; the owner opens deals in the CRM",
    );

  const pending = await findPendingProposal(supabase, {
    kind: "pipeline_move",
    opportunity_id: deal.id,
  });
  if (pending)
    throw new ProposalRefused(
      `A proposal for this deal is already waiting: ${pending.title}`,
    );

  const { data: stages, error: stageError } = await supabase
    .from("pipeline_stages")
    .select("id, name, pipeline_id")
    .order("position");
  if (stageError) throw new Error(stageError.message);
  const fromStage =
    (stages || []).find((s) => s.id === deal.stage_id)?.name ?? null;

  let target: { id: string; name: string; pipeline_id: string } | null = null;
  if (stageName) {
    target =
      (stages || []).find(
        (s) => s.name.toLowerCase() === stageName.toLowerCase(),
      ) ?? null;
    if (!target) {
      throw new ProposalRefused(
        `No stage named "${stageName}"; stages: ${(stages || []).map((s) => s.name).join(", ")}`,
      );
    }
    if (target.id === deal.stage_id)
      throw new ProposalRefused(`"${deal.name}" is already in ${target.name}`);
  }

  const reason = text(args.reason) || null;
  const lostReason = closeAs === "lost" ? text(args.lost_reason) || null : null;
  const title = closeAs
    ? `Close "${deal.name}" as ${closeAs}`
    : `Move "${deal.name}" to ${target!.name}`;
  const change = closeAs
    ? `close **${lit(deal.name)}** as **${closeAs}**${lostReason ? ` (${lit(lostReason)})` : ""}`
    : `move **${lit(deal.name)}** from **${lit(fromStage ?? "its stage")}** to **${lit(target!.name)}**`;
  return queue(
    supabase,
    proposer,
    title,
    {
      kind: "pipeline_move",
      proposed_by: proposer.agent,
      via: "mcp",
      reason,
      description:
        `${lit(proposer.agent)} proposes to ${change}.${reason ? `\n\nWhy: ${lit(reason)}` : ""}\n\n` +
        "Approving makes the change, unless the deal has moved since; rejecting changes nothing.",
      opportunity_id: deal.id,
      opportunity_name: deal.name,
      lead_id: deal.lead_id,
      from_stage_id: deal.stage_id,
      from_stage: fromStage,
      to_stage_id: target?.id ?? null,
      to_stage: target?.name ?? null,
      to_pipeline_id: target?.pipeline_id ?? null,
      close_as: (closeAs || null) as "won" | "lost" | null,
      lost_reason: lostReason,
    },
    QUEUED,
  );
}

export async function proposeArticle(
  supabase: AdminClient,
  args: Record<string, unknown>,
  proposer: Proposer,
): Promise<FiledProposal> {
  const title = text(args.title);
  const keyword = text(args.target_keyword);
  if (!title || !keyword)
    throw new ProposalRefused("title and target_keyword are required");
  const keywordKey = keyword.toLowerCase();

  const pending = await findPendingProposal(supabase, {
    kind: "article_topic",
    keyword_key: keywordKey,
  });
  if (pending)
    throw new ProposalRefused(
      `A proposal for "${keyword}" is already waiting: ${pending.title}`,
    );
  const existing = await calendarEntryForKeyword(supabase, keyword);
  if (existing)
    throw new ProposalRefused(
      `"${keyword}" is already on the calendar: ${existing.title} (${existing.status})`,
    );

  const priority = (
    ["high", "medium", "low"].includes(text(args.priority))
      ? text(args.priority)
      : "medium"
  ) as "high" | "medium" | "low";
  const notes = text(args.notes) || null;
  const pillar = text(args.pillar_topic) || null;
  const reason = text(args.reason) || null;
  return queue(
    supabase,
    proposer,
    `Article: ${title}`,
    {
      kind: "article_topic",
      proposed_by: proposer.agent,
      via: "mcp",
      reason,
      description:
        `**Title:** ${lit(title)}\n\n**Keyword:** ${lit(keyword)}${pillar ? `\n\n**Pillar:** ${lit(pillar)}` : ""}` +
        `\n\n**Priority:** ${priority}${notes ? `\n\n**Notes:** ${lit(notes)}` : ""}` +
        `${reason ? `\n\n**Why:** ${lit(reason)}` : ""}\n\n` +
        "Approving files it on the content calendar as approved. Nothing is written until someone presses Write now on it or a signed write-article call takes it; the publish mode then decides whether it lands as a draft or goes live.",
      title,
      target_keyword: keyword,
      keyword_key: keywordKey,
      keyword_cluster: text(args.keyword_cluster) || null,
      pillar_topic: pillar,
      priority,
      notes,
    },
    QUEUED,
  );
}

export async function proposeSocialDraft(
  supabase: AdminClient,
  args: Record<string, unknown>,
  proposer: Proposer,
): Promise<FiledProposal> {
  const caption = text(args.caption);
  if (!caption) throw new ProposalRefused("caption is required");
  const pending = await findPendingProposal(supabase, {
    kind: "social_draft",
    caption,
  });
  if (pending)
    throw new ProposalRefused(
      `This caption is already waiting: ${pending.title}`,
    );

  const title = text(args.title) || null;
  const mediaUrls = stringList(args.media_urls);
  const platforms = stringList(args.platforms);
  const reason = text(args.reason) || null;
  const label =
    title || (caption.length > 60 ? `${caption.slice(0, 57)}...` : caption);
  return queue(
    supabase,
    proposer,
    `Social post: ${label}`,
    {
      kind: "social_draft",
      proposed_by: proposer.agent,
      via: "mcp",
      reason,
      description:
        `${title ? `**Title:** ${lit(title)}\n\n` : ""}**Caption:**\n\n${lit(caption)}\n\n` +
        (mediaUrls.length
          ? `**Slides:** ${mediaUrls.length}\n\n`
          : "**Video post:** attach the video in the studio.\n\n") +
        `**Platforms:** ${platforms.length ? lit(platforms.join(", ")) : "every connected account"}` +
        `${reason ? `\n\n**Why:** ${lit(reason)}` : ""}\n\n` +
        "Approving saves it as a draft in the Social studio. Nothing posts until you schedule or publish it there.",
      caption,
      title,
      media_urls: mediaUrls,
      platforms,
    },
    QUEUED,
  );
}

// ── running on approval ─────────────────────────────────────────────────────

export interface ProposalExecDeps {
  afterPipelineMove?(
    supabase: AdminClient,
    payload: PipelineMovePayload,
  ): Promise<void>;
  logActivity(supabase: AdminClient, input: ActivityInput): Promise<void>;
  fireTrigger(
    supabase: AdminClient,
    event: { type: "stage_changed"; lead: Lead; data: Record<string, unknown> },
  ): Promise<unknown>;
  /** The Operator's create_social_draft executor. */
  createSocialDraft(input: Record<string, unknown>): Promise<{ data: unknown }>;
}

interface ApprovedRow {
  id: string;
  payload: unknown;
}

async function runPipelineMove(
  supabase: AdminClient,
  action: ApprovedRow,
  deps: ProposalExecDeps,
): Promise<Json> {
  const p = action.payload as PipelineMovePayload;
  const { data: deal, error } = await supabase
    .from("opportunities")
    .select("id, name, lead_id, status, stage_id")
    .eq("id", p.opportunity_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!deal)
    throw new ProposalRefused("The deal no longer exists; nothing changed");
  if (deal.status !== "open") {
    throw new ProposalRefused(
      `"${deal.name}" was closed as ${deal.status} after this was proposed; nothing changed`,
    );
  }
  if (deal.stage_id !== p.from_stage_id) {
    throw new ProposalRefused(
      `"${deal.name}" moved after this was proposed (it was in ${p.from_stage ?? "another stage"}); nothing changed. Ask for a fresh proposal.`,
    );
  }

  const now = new Date().toISOString();
  const patch = p.close_as
    ? p.close_as === "won"
      ? { status: "won" as const, won_at: now }
      : { status: "lost" as const, lost_at: now, lost_reason: p.lost_reason }
    : {
        stage_id: p.to_stage_id as string,
        pipeline_id: p.to_pipeline_id as string,
      };
  // Guarded on the state just checked, so a concurrent change cannot be overwritten.
  const { data: moved, error: moveError } = await supabase
    .from("opportunities")
    .update(patch)
    .eq("id", deal.id)
    .eq("status", "open")
    .eq("stage_id", p.from_stage_id)
    .select("id");
  if (moveError) throw new Error(moveError.message);
  if (!moved?.length)
    throw new ProposalRefused(
      `"${deal.name}" changed while this was being approved; nothing changed`,
    );

  const actor = `agent:${p.proposed_by}`;
  const data = {
    opportunity_id: deal.id,
    agent_action_id: action.id,
    approved_by: "owner",
  };
  if (p.close_as) {
    await deps.logActivity(supabase, {
      lead_id: deal.lead_id,
      activity_type: "stage_changed",
      title: `Deal ${p.close_as}: ${deal.name}${p.lost_reason ? ` (${p.lost_reason})` : ""}`,
      data,
      actor,
    });
    await deps.afterPipelineMove?.(supabase, p);
    return { opportunity_id: deal.id, status: p.close_as };
  }

  await deps.logActivity(supabase, {
    lead_id: deal.lead_id,
    activity_type: "stage_changed",
    title: `Moved to stage: ${p.to_stage}`,
    data: { ...data, stage_id: p.to_stage_id },
    actor,
  });
  const { data: lead } = await supabase
    .from("leads")
    .select("*")
    .eq("id", deal.lead_id)
    .maybeSingle();
  if (lead)
    await deps.fireTrigger(supabase, {
      type: "stage_changed",
      lead: lead as Lead,
      data: { stage_id: p.to_stage_id },
    });
  await deps.afterPipelineMove?.(supabase, p);
  return { opportunity_id: deal.id, stage: p.to_stage };
}

async function runArticleTopic(
  supabase: AdminClient,
  action: ApprovedRow,
): Promise<Json> {
  const p = action.payload as ArticleTopicPayload;
  const existing = await calendarEntryForKeyword(supabase, p.target_keyword);
  if (existing)
    throw new ProposalRefused(
      `"${p.target_keyword}" is already on the calendar: ${existing.title}`,
    );
  const { data, error } = await supabase
    .from("content_calendar")
    .insert({
      title: p.title,
      target_keyword: p.target_keyword,
      search_query: p.target_keyword,
      keyword_cluster: p.keyword_cluster,
      pillar_topic: p.pillar_topic,
      priority: p.priority,
      status: "approved",
      // The column's agent vocabulary predates named keys; the note names who proposed it.
      created_by: "content_agent",
      notes: `[Proposed by ${p.proposed_by} over MCP, approved by the owner] ${p.notes || "No notes."}`,
    })
    .select("id, status")
    .single();
  if (error?.code === "23505")
    throw new ProposalRefused(
      `"${p.target_keyword}" is already on the calendar`,
    );
  if (error || !data)
    throw new Error(
      `Could not file the topic: ${error?.message || "no row returned"}`,
    );
  return { calendar_entry_id: data.id, status: data.status };
}

async function runSocialDraft(
  supabase: AdminClient,
  action: ApprovedRow,
  deps: ProposalExecDeps,
): Promise<Json> {
  const p = action.payload as SocialDraftPayload;
  const outcome = await deps.createSocialDraft({
    caption: p.caption,
    title: p.title || undefined,
    media_urls: p.media_urls.length ? p.media_urls : undefined,
    platforms: p.platforms.length ? p.platforms : undefined,
  });
  const postId = (outcome.data as { post_id?: string } | null)?.post_id;
  if (postId)
    await supabase
      .from("social_posts")
      .update({ created_by: `agent:${p.proposed_by}` })
      .eq("id", postId);
  return outcome.data as Json;
}

/** Runs an approved agent proposal. Null when the row is not one. */
export async function executeAgentProposal(
  supabase: AdminClient,
  action: ApprovedRow,
  deps: ProposalExecDeps,
): Promise<Json | null> {
  switch (agentProposalKind(action.payload)) {
    case "pipeline_move":
      return runPipelineMove(supabase, action, deps);
    case "article_topic":
      return runArticleTopic(supabase, action);
    case "social_draft":
      return runSocialDraft(supabase, action, deps);
    default:
      return null;
  }
}
