/**
 * The MCP tool belt's public half: every tool's name, description, argument
 * schema, scopes (all required; none = any key) and approval class. The
 * handlers live beside it (./home.ts, ./leads.ts, ...) and ./index.ts joins
 * the two.
 *
 * Pure on purpose, so `node --test` can check the whole belt: scopes in the
 * vocabulary, no `outward` tool, schemas the validator understands.
 *
 * Approval classes: `none` reads, or writes only inside the Home (a note on
 * a lead's timeline). `proposes` only queues an agent_actions row for the
 * owner's Approve or Reject (src/lib/agent/proposals.ts runs it on approval).
 * Nothing here sends, publishes, spends or deletes.
 */

import type { McpToolSpec } from "../types.ts";
import type { JsonSchema } from "../validate.ts";

const LEAD_ID: JsonSchema = {
  type: "string",
  minLength: 1,
  maxLength: 64,
  description: "Lead UUID",
};
const LEAD_EMAIL: JsonSchema = {
  type: "string",
  minLength: 3,
  maxLength: 320,
  description: "Lead email address",
};
const LEAD_STATUSES = [
  "new",
  "engaged",
  "qualified",
  "converted",
  "lost",
] as const;
const CALENDAR_STATUSES = [
  "planned",
  "approved",
  "writing",
  "draft",
  "published",
  "archived",
] as const;
const ACTION_STATUSES = [
  "proposed",
  "approved",
  "rejected",
  "executed",
  "failed",
] as const;

const NO_ARGS = {
  type: "object" as const,
  properties: {},
  additionalProperties: false,
};

export const MCP_TOOL_SPECS: readonly McpToolSpec[] = [
  {
    name: "home.info",
    title: "About this Home",
    description:
      "What this Digital Home is: version, available capabilities, applied migrations and whether safe mode is on. Read it first.",
    inputSchema: NO_ARGS,
    scopes: [],
    approval: "none",
    readOnly: true,
  },
  {
    name: "home.guide",
    title: "The Home's route guide",
    description:
      "The machine-readable guide to this Home's HTTP routes (home_guide_v1): each route's purpose, scope and approval class, how to sign requests, and the house rules for agents.",
    inputSchema: NO_ARGS,
    scopes: [],
    approval: "none",
    readOnly: true,
  },
  {
    name: "leads.search",
    title: "Search leads",
    description:
      "Find leads in the CRM. query matches email, first or last name; filter by status, tag, how recent, or minimum score. Newest first, or hottest first with order_by='score'.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          minLength: 1,
          maxLength: 120,
          description: "Part of an email or name",
        },
        status: {
          type: "string",
          enum: LEAD_STATUSES,
          description: "Lead status",
        },
        tag: {
          type: "string",
          minLength: 1,
          maxLength: 80,
          description: "Only leads carrying this tag",
        },
        since_days: {
          type: "integer",
          minimum: 1,
          maximum: 3650,
          description: "Created in the last N days",
        },
        min_score: {
          type: "number",
          minimum: 0,
          description: "Score at least this",
        },
        order_by: {
          type: "string",
          enum: ["newest", "score"],
          description: "Default newest",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          description: "Default 25",
        },
      },
      additionalProperties: false,
    },
    scopes: ["leads:read"],
    approval: "none",
    readOnly: true,
  },
  {
    name: "leads.get",
    title: "Get a lead",
    description:
      "One lead's full record, their ten latest timeline entries. Pass lead_id or email.",
    inputSchema: {
      type: "object",
      properties: { lead_id: LEAD_ID, email: LEAD_EMAIL },
      additionalProperties: false,
    },
    scopes: ["leads:read"],
    approval: "none",
    readOnly: true,
  },
  {
    name: "leads.timeline",
    title: "A lead's timeline",
    description:
      "A lead's activity timeline, newest first: notes, emails, form fills, tags, stage changes. Page back by passing the answer's next_cursor as cursor. Pass lead_id or email.",
    inputSchema: {
      type: "object",
      properties: {
        lead_id: LEAD_ID,
        email: LEAD_EMAIL,
        activity_type: {
          type: "string",
          minLength: 1,
          maxLength: 60,
          description: "Only this type, e.g. note, email_sent",
        },
        cursor: {
          type: "string",
          minLength: 20,
          maxLength: 120,
          description: "next_cursor from the previous page",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          description: "Default 25",
        },
      },
      additionalProperties: false,
    },
    scopes: ["leads:read"],
    approval: "none",
    readOnly: true,
  },
  {
    name: "leads.add_note",
    title: "Add a note to a lead",
    description:
      "Write a note on a lead's timeline, signed with your agent name. Visible to the owner in the CRM; nothing reaches the lead. Pass lead_id or email.",
    inputSchema: {
      type: "object",
      properties: {
        lead_id: LEAD_ID,
        email: LEAD_EMAIL,
        note: {
          type: "string",
          minLength: 1,
          maxLength: 5000,
          description: "The note text",
        },
      },
      required: ["note"],
      additionalProperties: false,
    },
    scopes: ["leads:write"],
    approval: "none",
    readOnly: false,
  },
  {
    name: "pipeline.list",
    title: "The sales pipeline",
    description:
      "Pipeline stages and up to 500 most recently updated deals. stalled_only=true selects deals untouched for 7+ days.",
    inputSchema: {
      type: "object",
      properties: {
        stalled_only: { type: "boolean", description: "Only stalled deals" },
        include_closed: {
          type: "boolean",
          description: "Include won and lost deals",
        },
      },
      additionalProperties: false,
    },
    scopes: ["leads:read"],
    approval: "none",
    readOnly: true,
  },
  {
    name: "pipeline.move",
    title: "Propose a deal move",
    description:
      "Propose moving a deal to another stage, or closing it as won or lost. Never moves it: it queues an Approve/Reject card in the owner's approvals queue, and approving it is what moves the deal (refused if the deal moved in the meantime). One pending proposal per deal. Name the deal by opportunity_id or the lead's email (their open deal). Follow it with approvals.mine.",
    inputSchema: {
      type: "object",
      properties: {
        opportunity_id: { type: "string", minLength: 1, maxLength: 64 },
        email: {
          ...LEAD_EMAIL,
          description: "Lead email: uses their open deal",
        },
        stage: {
          type: "string",
          minLength: 1,
          maxLength: 80,
          description: "Target stage name",
        },
        close_as: {
          type: "string",
          enum: ["won", "lost"],
          description: "Close the deal instead of moving it",
        },
        lost_reason: {
          type: "string",
          maxLength: 500,
          description: "Why it was lost, with close_as='lost'",
        },
        reason: {
          type: "string",
          maxLength: 500,
          description: "One line for the owner: why this move",
        },
      },
      additionalProperties: false,
    },
    scopes: ["approvals:propose", "leads:read"],
    approval: "proposes",
    readOnly: false,
  },
  {
    name: "calendar.list",
    title: "The content calendar",
    description:
      "The article calendar, newest first: planned and approved topics, articles being written, drafts in review, published pieces. Filter by status.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: CALENDAR_STATUSES },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          description: "Default 20",
        },
      },
      additionalProperties: false,
    },
    scopes: ["content:read"],
    approval: "none",
    readOnly: true,
  },
  {
    name: "article.propose",
    title: "Propose an article",
    description:
      "Propose an article topic: queues an Approve/Reject card in the owner's approvals queue. Approving files it on the content calendar as approved, where it waits for the owner's Write now or a signed write-article call; rejecting files nothing. Refused when the keyword (ignoring case) is already on the calendar or already proposed.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          minLength: 3,
          maxLength: 200,
          description: "A specific, search-worthy title",
        },
        target_keyword: {
          type: "string",
          minLength: 2,
          maxLength: 120,
          description: "The search phrase it should rank for",
        },
        keyword_cluster: { type: "string", maxLength: 80 },
        pillar_topic: {
          type: "string",
          maxLength: 80,
          description: "The content pillar it argues, if the Home uses pillars",
        },
        priority: {
          type: "string",
          enum: ["high", "medium", "low"],
          description: "Default medium",
        },
        notes: {
          type: "string",
          maxLength: 2000,
          description: "Angle and context for the writer",
        },
        reason: {
          type: "string",
          maxLength: 500,
          description: "One line for the owner: why this article",
        },
      },
      required: ["title", "target_keyword"],
      additionalProperties: false,
    },
    scopes: ["content:write"],
    approval: "proposes",
    readOnly: false,
  },
  {
    name: "social.propose",
    title: "Propose a social post",
    description:
      "Propose a social post: queues an Approve/Reject card in the owner's approvals queue. Approving saves it as a DRAFT in the Social studio, aimed at every connected account unless narrowed; a draft never goes out by itself. Pass 1-10 hosted image URLs for an image post (Instagram and Facebook), or none for a video post.",
    inputSchema: {
      type: "object",
      properties: {
        caption: {
          type: "string",
          minLength: 1,
          maxLength: 2200,
          description: "The caption, hashtags included",
        },
        title: {
          type: "string",
          maxLength: 100,
          description: "Internal label; doubles as the YouTube title",
        },
        media_urls: {
          type: "array",
          items: { type: "string", minLength: 8, maxLength: 2000 },
          minItems: 1,
          maxItems: 10,
          description: "Image slides in order (1 = single photo)",
        },
        platforms: {
          type: "array",
          items: { type: "string", enum: ["instagram", "facebook", "youtube"] },
          minItems: 1,
          maxItems: 3,
          description: "Limit to these platforms",
        },
        reason: {
          type: "string",
          maxLength: 500,
          description: "One line for the owner: why this post",
        },
      },
      required: ["caption"],
      additionalProperties: false,
    },
    scopes: ["social:write"],
    approval: "proposes",
    readOnly: false,
  },
  {
    name: "brand.playbook.get",
    title: "The Brand Playbook",
    description:
      "The owner's Brand Playbook: audience, positioning, voice and standing rules. Read it before writing anything in their name. slug defaults to 'current'; the answer lists the archived slugs too.",
    inputSchema: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          minLength: 1,
          maxLength: 120,
          description: "Default current",
        },
      },
      additionalProperties: false,
    },
    scopes: ["brand:read"],
    approval: "none",
    readOnly: true,
  },
  {
    name: "approvals.list",
    title: "The approvals queue",
    description:
      "The owner's approvals queue, newest first: what is waiting for a yes, and what was approved, rejected, executed or failed. Titles and summaries need leads:read too (they name leads); without it you get each item's type, status and time only.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ACTION_STATUSES,
          description: "proposed = waiting for a yes; omit for all",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          description: "Default 25",
        },
      },
      additionalProperties: false,
    },
    scopes: ["approvals:propose"],
    approval: "none",
    readOnly: true,
  },
  {
    name: "approvals.mine",
    title: "My proposals",
    description:
      "The proposals your key queued (deal moves, articles, social posts), newest first, with their payload, the owner's decision and the result of running them.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ACTION_STATUSES },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          description: "Default 25",
        },
      },
      additionalProperties: false,
    },
    scopes: [],
    approval: "none",
    readOnly: true,
  },
];
