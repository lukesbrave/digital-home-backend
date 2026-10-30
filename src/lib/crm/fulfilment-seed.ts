/** Three recipe families, always created as drafts. The stage recipe has one
 * workflow per stage so a later milestone does not collide with an earlier
 * stage's active enrollment. Stable names follow nation-seed's lookup pattern. */
import type { AdminClient, WorkflowStep } from "./types.ts";
import type { Json } from "../../types/database.ts";

export const ONBOARDING_NAME = "Fulfilment — Purchase onboarding";
export const REVIEW_NAME = "Fulfilment — Delivery review request";
export const ONBOARDING_SETTING = "money_onboarding_workflow";
const CATEGORY = "fulfilment";

export const PROJECT_STAGES = {
  brief: ["Let's get your project started", "We're getting started on {{custom.engagement_name|your project}}. Reply with your main goal, any dates we need to work around, and anything you would like us to know."],
  research: ["We've started the research", "We've started the research for {{custom.engagement_name|your project}}. We're looking at your audience and what matters to them. If you have customer feedback or examples you want us to consider, reply and send them through."],
  copy: ["We're working on your copy", "We're writing the copy for {{custom.engagement_name|your project}}. We're turning the research into clear messages for your customers. We'll let you know when it's ready for your feedback."],
  design: ["We're working on your design", "{{custom.engagement_name|Your project}} has moved into design. We're shaping how the words and visuals work together. If you have any last visual references to share, reply here."],
  review: ["Your copy and design are ready for review", "The copy and design for {{custom.engagement_name|your project}} are ready for your review. Please bring your feedback together in one reply so we can work through it. If you need the review files or link, just ask here."],
  build: ["We're building your project", "We've started the build for {{custom.engagement_name|your project}}. We're putting the agreed pieces together and checking that they work. We'll keep you posted as we get ready to launch."],
  launch: ["Your project has reached launch", "{{custom.engagement_name|Your project}} has reached the launch stage. Thank you for working through it with us. Reply if you have any questions about the handover or what comes next."],
} as const;

export const FULFILMENT_RECIPES = [
  { recipe: "purchase-onboarding", names: [ONBOARDING_NAME] },
  { recipe: "project-status", names: Object.keys(PROJECT_STAGES).map((stage) => `Fulfilment — Project ${stage}`) },
  { recipe: "delivery-review", names: [REVIEW_NAME] },
] as const;

function checked<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`fulfilment: ${what}: ${result.error.message}`);
  return result.data;
}

async function findWorkflow(supabase: AdminClient, name: string) {
  const rows = checked(await supabase.from("workflows").select("id, name, status")
    .eq("name", name).order("created_at", { ascending: true }).limit(1), "workflow lookup");
  return rows?.[0] ?? null;
}

export async function fulfilmentRecipeState(supabase: AdminClient) {
  const recipes = [];
  for (const recipe of FULFILMENT_RECIPES) {
    const workflows = [];
    for (const name of recipe.names) {
      const row = await findWorkflow(supabase, name);
      workflows.push({ name, seeded: !!row, workflow_id: row?.id ?? null, status: row?.status ?? null });
    }
    recipes.push({ recipe: recipe.recipe, workflows });
  }
  return recipes;
}

export async function seedFulfilmentRecipes(supabase: AdminClient) {
  const templates: Array<{ name: string; id: string; created: boolean }> = [];
  const workflows: Array<{ recipe: string; name: string; id: string; status: string; created: boolean }> = [];

  async function email(key: string, subject: string, body: string): Promise<WorkflowStep> {
    const name = `Fulfilment — ${key}`;
    const rows = checked(await supabase.from("email_templates").select("id")
      .eq("name", name).order("created_at", { ascending: true }).limit(1), "template lookup");
    const existing = rows?.[0];
    const content = { subject, body_md: `Hi {{first_name|there}},\n\n${body}`, preheader: null, category: CATEGORY };
    let id: string;
    if (existing) {
      id = existing.id;
    } else {
      const row = checked(await supabase.from("email_templates").insert({ name, ...content, ai_generated: false })
        .select("id").single(), "template insert");
      if (!row) throw new Error("fulfilment: template insert returned nothing");
      id = row.id;
    }
    templates.push({ name, id, created: !existing });
    return { id: key, type: "send_email", config: { template_id: id } };
  }

  async function workflow(recipe: string, name: string, description: string, trigger_type: string,
    trigger_config: Json, steps: WorkflowStep[], allow_reenrollment = false) {
    const existing = await findWorkflow(supabase, name);
    const content = { description, trigger_type, trigger_config, steps: steps as unknown as Json, allow_reenrollment };
    let row;
    if (existing) {
      // Existing member workflows are owned by the member. Never refresh their content.
      row = existing;
    } else {
      row = checked(await supabase.from("workflows").insert({ name, ...content, status: "draft" })
        .select("id, status").single(), "workflow insert");
    }
    if (!row) throw new Error("fulfilment: workflow insert returned nothing");
    workflows.push({ recipe, name, id: row.id, status: row.status, created: !existing });
    return row.id;
  }

  const wait = (days: number): WorkflowStep => ({ id: `wait-${days}`, type: "wait", config: { days } });
  const onboardingId = await workflow("purchase-onboarding", ONBOARDING_NAME,
    "Welcome a new customer, help them get started, then check in. Review the emails and enable when ready.",
    "tag_added", { tag: "customer" }, [
      await email("Welcome", "Welcome, and thank you", "Thank you for your purchase. We're glad you're here. Keep your order confirmation handy, and reply if you need help finding your next step.\n\nWhat would you most like to get out of this? We'd love to know."),
      wait(2),
      await email("Getting the most out of it", "How to get the most out of it", "A little time set aside now can make getting started easier. Pick one outcome you want, take the first step in your purchase or welcome instructions, and keep a note of any questions.\n\nIf you're unsure where to start, reply and tell us what you're working towards."),
      wait(5),
      await email("Check in", "How is it going?", "You've had a little time to get started, so we wanted to check in. How is it going?\n\nIf something is unclear or you're stuck, reply with a few words about it. We'd be happy to help."),
    ]);

  for (const [stage, [subject, body]] of Object.entries(PROJECT_STAGES)) {
    await workflow("project-status", `Fulfilment — Project ${stage}`,
      `Tell the client when their project enters ${stage}. Review the email and enable when ready.`,
      "engagement_stage_changed", { stage }, [await email(`Stage ${stage}`, subject, body)], true);
  }

  await workflow("delivery-review", REVIEW_NAME,
    "Ask for a review after delivery, remind once after seven days, and tag review-requested. The owner or agent adds delivered when the last deliverable is done; completing all tracked deliverables also adds it.",
    "tag_added", { tag: "delivered" }, [
      await email("Thank you and review", "Thank you — how was your experience?", "Thank you for trusting us with your project. Now that it's delivered, we'd love to hear how the experience was for you.\n\nWould you reply with a short review? What did you need help with, and what has changed for you? A few honest lines would mean a lot."),
      wait(7),
      await email("Review reminder", "A gentle reminder", "Just a quick follow-up on our review request. If you have a moment, we'd appreciate a few honest words about your experience. You can reply right here.\n\nIf you've already shared your feedback, thank you — there's nothing more you need to do."),
      { id: "review-requested", type: "add_tag", config: { tag: "review-requested" } },
    ]);

  const setting = checked(await supabase.from("backend_settings").select("value")
    .eq("key", ONBOARDING_SETTING).maybeSingle(), "onboarding setting lookup");
  if (!setting) {
    // A concurrent owner setting wins; never overwrite it.
    const result = await supabase.from("backend_settings").insert({ key: ONBOARDING_SETTING, value: onboardingId });
    if (result.error?.code !== "23505") checked(result, "onboarding setting insert");
  } else if (setting.value === null || setting.value === "") {
    // value is NOT NULL jsonb: JSON null and a JSON string need JSON literals
    // in the PostgREST filter, rather than SQL IS NULL or an unquoted string.
    checked(await supabase.from("backend_settings").update({ value: onboardingId })
      .eq("key", ONBOARDING_SETTING).eq("value", JSON.stringify(setting.value)), "onboarding setting update");
  }
  return { workflows, templates };
}
