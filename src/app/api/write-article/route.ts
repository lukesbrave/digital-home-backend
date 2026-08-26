/**
 * POST /api/write-article — AI-powered article writer
 *
 * Takes a calendar_entry_id, calls Claude to write the full article,
 * saves it to content_objects via the Frontend API, and updates the
 * calendar entry status.
 *
 * Respects publish mode:
 * - safe: article saved as "draft" for review
 * - autonomous: article saved as "published" directly
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticateSessionOrApiKey, unauthorizedResponse } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { BRAND_PROJECTION_KEYS } from "@/lib/brand/playbook-contract";


const FRONTEND_URL =
  process.env.DIGITAL_HOME_URL || "http://localhost:3000";
const API_KEY = process.env.API_SECRET_KEY || "";
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";

/**
 * Fetch from the Frontend Worker using the service binding (bypasses Workers-to-Workers routing issues).
 * Falls back to global fetch for local dev where no service binding exists.
 */
function frontendFetch(path: string, init?: RequestInit): Promise<Response> {
  try {
    const ctx = getCloudflareContext();
    const binding = ctx.env.FRONTEND_WORKER;
    if (binding) {
      return binding.fetch(new Request(`${FRONTEND_URL}${path}`, init));
    }
  } catch {
    // Local dev — no Cloudflare context available
  }
  return fetch(`${FRONTEND_URL}${path}`, init);
}

// ─── Brand context loader ────────────────────────────────────────────────────

interface BrandContext {
  fullContext: string;
  ctaLinks: string;
  activeOffers: string;
  authorName: string;
  imageStyle: string;
}

async function loadBrandContext(): Promise<BrandContext> {
  const supabase = createAdminClient();

  const { data: dbContext } = await supabase
    .from("brand_context")
    .select("key, category, content")
    .order("category");

  const rows = dbContext || [];

  const missingCore = BRAND_PROJECTION_KEYS.filter(
    (key) => !rows.some((row) => row.key === key && row.content?.trim())
  );
  if (missingCore.length > 0) {
    throw new Error(
      `Brand context is not ready for article writing. Missing Playbook projection rows: ${missingCore.join(", ")}. ` +
        "Run the scoped Brand Playbook publisher sync before writing."
    );
  }

  const fullContext = rows
    .map((row) => `# ${row.category}/${row.key}\n\n${row.content}`)
    .join("\n\n---\n\n");

  // Extract CTA links from brand context (category: "cta", key: "links")
  const ctaRow = rows.find((r) => r.category === "cta" && r.key === "links");
  const ctaLinks = ctaRow?.content || "";

  const { data: offers, error: offersError } = await supabase
    .from("offers")
    .select("name, tagline, description, price_display, cta_text, cta_url, who_its_for")
    .eq("status", "active")
    .order("position_in_ladder", { ascending: true, nullsFirst: false });
  if (offersError) throw new Error(`Operational offer readiness check failed: ${offersError.message}`);
  const activeOffers = (offers || []).map((offer) => [
    `- ${offer.name}`,
    offer.who_its_for ? `For: ${offer.who_its_for}` : null,
    offer.tagline || offer.description || null,
    offer.price_display ? `Approved price display: ${offer.price_display}` : null,
    offer.cta_text ? `CTA label: ${offer.cta_text}` : null,
    offer.cta_url ? `CTA URL: ${offer.cta_url}` : null,
  ].filter(Boolean).join("\n  ")).join("\n");

  // Extract author name from brand context (category: "identity", key: "author")
  const authorRow = rows.find((r) => r.category === "identity" && r.key === "author");
  const authorName = authorRow?.content?.trim() || "Content Agent";

  // Extract image style from brand context (category: "content", key: "image_style")
  const imageRow = rows.find((r) => r.category === "content" && r.key === "image_style");
  const imageStyle = imageRow?.content?.trim() || "";

  return { fullContext, ctaLinks, activeOffers, authorName, imageStyle };
}

// ─── Fetch existing articles for internal linking ────────────────────────────

async function fetchPublishedSlugs(): Promise<
  { slug: string; title: string; path: string }[]
> {
  try {
    const res = await frontendFetch(
      "/api/content?status=published&limit=20",
      { headers: { "x-api-key": API_KEY } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const items = data.data || data.articles || data.content || [];
    return items.map(
      (a: { slug: string; title: string }) => ({
        slug: a.slug,
        title: a.title,
        // Canonical URL on the site. Adjust if your frontend routes articles
        // under a different base path.
        path: `/blog/${a.slug}`,
      })
    );
  } catch {
    return [];
  }
}

// ─── Hero image generation ───────────────────────────────────────────────────

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// Rotated deterministically per slug so consecutive articles never share a frame.
const COMPOSITIONS = [
  "Composition: vast wide establishing shot, monumental subject dwarfing the frame, atmospheric haze and god rays.",
  "Composition: low-angle hero shot looking up at a towering subject against a dramatic sky or void.",
  "Composition: aerial view over a surreal landscape, the subject glowing at its center.",
  "Composition: interior of a colossal space (temple, vault, engine, cathedral of the idea), light pouring in.",
  "Composition: a single luminous structure suspended or floating in darkness, energy radiating outward.",
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

async function generateHeroImage(
  title: string,
  keyword: string,
  slug: string,
  imageStyle?: string,
  imageConcept?: string
): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) return null;

  try {
    const openai = new OpenAI();

    // Default style if none configured in brand_context
    const defaultStyle = `Epic cinematic concept art. Monumental scale, surreal, otherworldly.
Vivid saturated color blooming out of deep darkness: volumetric god rays, glowing energy, luminous materials.
Hyperdetailed painterly-photoreal hybrid. Never a product photo or flat still life.`;

    const styleGuide = imageStyle || defaultStyle;
    const composition = COMPOSITIONS[hashString(slug) % COMPOSITIONS.length];
    const subject = imageConcept
      ? `Subject (build the whole frame around this): ${imageConcept}`
      : `Subject: one clear physical object or scene that works as a metaphor for the topic "${keyword}".`;

    const imagePrompt = `Create a hero image for a blog article titled "${title}" (topic: ${keyword}).

${subject}

${styleGuide}
${composition}

CRITICAL RULES:
- ABSOLUTELY NO TEXT. No words, letters, numbers, logos, watermarks, or signatures
- No documents, charts, screens, books or paper with visible writing — these render as garbled fake text
- No close-up faces, no handshakes, no people pointing at screens; tiny silhouettes for scale are fine
- No beige/bronze desk still lifes: no typewriters, chess boards, compasses, padlocks or statues on tables
- Vivid and readable at thumbnail size: strong color against darkness, clear focal point`;

    const isDalleModel = OPENAI_IMAGE_MODEL.startsWith("dall-e");
    const response = await openai.images.generate({
      model: OPENAI_IMAGE_MODEL,
      prompt: imagePrompt,
      n: 1,
      size: isDalleModel ? "1792x1024" : "1536x1024",
      quality: isDalleModel ? "hd" : "high",
      ...(isDalleModel ? { response_format: "url" } : {}),
    } as Parameters<typeof openai.images.generate>[0]);

    const imageResponse = response as unknown as {
      data?: Array<{ b64_json?: string | null; url?: string | null }>;
    };
    const generated = imageResponse.data?.[0];
    let imageBuffer: ArrayBuffer | null = null;
    if (generated?.b64_json) {
      imageBuffer = base64ToArrayBuffer(generated.b64_json);
    } else if (generated?.url) {
      const imageRes = await fetch(generated.url);
      if (!imageRes.ok) return null;
      imageBuffer = await imageRes.arrayBuffer();
    }
    if (!imageBuffer) return null;

    const supabase = createAdminClient();
    const fileName = `blog/${slug}-hero.png`;

    const { error: uploadError } = await supabase.storage
      .from("images")
      .upload(fileName, imageBuffer, {
        contentType: "image/png",
        upsert: true,
      });

    if (uploadError) {
      console.error("Image upload failed:", uploadError.message);
      return null;
    }

    // Get the public URL
    const { data: publicUrl } = supabase.storage
      .from("images")
      .getPublicUrl(fileName);

    return publicUrl.publicUrl;
  } catch (err) {
    console.error("Hero image generation failed:", err);
    return null;
  }
}

// ─── JSON repair ─────────────────────────────────────────────────────────────

/**
 * Repair broken JSON caused by unescaped double quotes inside string values.
 *
 * Claude sometimes outputs HTML like <a href="url"> inside a JSON string
 * without escaping the quotes. This function detects those unescaped quotes
 * and adds backslash escapes so JSON.parse can handle it.
 *
 * Heuristic: In valid JSON, a closing " is always followed by : , } ] or
 * whitespace before one of those. If a " inside a string is followed by
 * something else (like a letter), it's an unescaped interior quote.
 *
 * This function is a no-op on already-valid JSON.
 */
function repairJsonQuotes(text: string): string {
  const result: string[] = [];
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (escapeNext) {
      result.push(char);
      escapeNext = false;
      continue;
    }

    if (char === "\\") {
      result.push(char);
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      if (!inString) {
        inString = true;
        result.push(char);
      } else {
        // Is this closing the string, or an unescaped quote inside it?
        // Look ahead past any whitespace for a JSON structural character
        let j = i + 1;
        while (j < text.length && text[j] === " ") j++;
        const next = text[j];

        if (
          next === ":" || next === "," || next === "}" ||
          next === "]" || next === undefined
        ) {
          // Looks like a real string boundary
          inString = false;
          result.push(char);
        } else {
          // Unescaped quote inside a string value — escape it
          result.push("\\");
          result.push(char);
        }
      }
      continue;
    }

    result.push(char);
  }

  return result.join("");
}

// ─── Main handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);

  const triggerSource =
    auth.mode === "api-key"
      ? { auth_mode: "api-key", triggered_by: auth.agent }
      : { auth_mode: "session", triggered_by: auth.userId };

  const body = await request.json();
  let { calendar_entry_id } = body;
  const publish_mode = body.publish_mode;

  // Check for Anthropic API key
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      {
        error:
          "ANTHROPIC_API_KEY not configured. Add it to .env.local to enable AI writing.",
      },
      { status: 500 }
    );
  }

  const supabase = createAdminClient();

  // If no calendar_entry_id, auto-select the next approved entry
  if (!calendar_entry_id) {
    const { data: nextEntry, error: selectError } = await supabase
      .from("content_calendar")
      .select("id")
      .eq("status", "approved")
      .order("created_at", { ascending: true })
      .limit(1)
      .single();

    if (selectError || !nextEntry) {
      return NextResponse.json(
        { error: "No approved entries in the content calendar. Approve a topic first." },
        { status: 404 }
      );
    }

    calendar_entry_id = nextEntry.id;
  }

  // 1. Fetch the calendar entry
  const { data: entry, error: entryError } = await supabase
    .from("content_calendar")
    .select("*")
    .eq("id", calendar_entry_id)
    .single();

  if (entryError || !entry) {
    return NextResponse.json(
      { error: "Calendar entry not found" },
      { status: 404 }
    );
  }

  // 2. Get publish mode from settings
  const { data: settingsData } = await supabase
    .from("backend_settings")
    .select("value")
    .eq("key", "publish_mode")
    .single();

  // Explicit caller intent wins (a caller can force "safe" so its drafts
  // never auto-publish); otherwise fall back to the global setting.
  const publishMode =
    publish_mode === "autonomous" || publish_mode === "safe"
      ? publish_mode
      : settingsData?.value === "autonomous"
        ? "autonomous"
        : "safe";
  const targetStatus = publishMode === "autonomous" ? "published" : "draft";

  // 3. Mark as writing
  await supabase
    .from("content_calendar")
    .update({ status: "writing" })
    .eq("id", calendar_entry_id);

  try {
    // 4. Load brand context and existing articles
    const [brand, publishedArticles] = await Promise.all([
      loadBrandContext(),
      fetchPublishedSlugs(),
    ]);

    const internalLinks = publishedArticles.length > 0
      ? `\n\nExisting articles for internal linking (use these exact paths — they are the canonical URLs):\n${publishedArticles
          .map((a) => `- ${a.path} — "${a.title}"`)
          .join("\n")}`
      : "";

    // Build CTA instruction from brand context
    const ctaInstruction = brand.ctaLinks
      ? `- The CTA section MUST include one of the links below (choose the most relevant for the article topic). Use ONLY these exact links — do not modify the URLs or create new ones:\n${brand.ctaLinks}`
      : brand.activeOffers
        ? `- Match the CTA to one active operational offer below. Use only its recorded name, price, status and URL; omit any field that is absent and never infer it:\n${brand.activeOffers}`
        : "- No active operational offer or configured CTA link exists. End with a non-transactional, no-link next step grounded in the approved offer core. Do not invent a price, URL, checkout destination, testimonial, active status, or availability claim. This draft requires CTA readiness review before publication.";

    // 5. Call Claude to write the article
    const anthropic = new Anthropic();

    const systemPrompt = `You are a Content Agent. You write articles optimized for human readers and AI systems.

${brand.fullContext}
${internalLinks}

IMPORTANT RULES:
- Write in the brand voice defined above. Follow the voice guide, tone examples, and banned phrases strictly.
- Match the tone and style in the tone examples — study them carefully. They define how the brand actually sounds.
- Reading level: 9th grade. Short sentences. Plain words. No jargon.
- Article length: MINIMUM 2,000 words, target 2,500-3,500 words. This is non-negotiable. Short articles get rejected.
- Depth over breadth: this publishes a few times a week, not daily — every article must earn its slot. Ground every major claim in something concrete: a named example, a number, a step the reader can take today, or a real case from the brand context. If a section could appear on any competitor's blog unchanged, rewrite it with the brand's specific frameworks and stories.
- Every paragraph should be a dense, contextually complete semantic unit. Prefer paragraph-based exposition over bullet points.
- Do NOT include the article title as an H1 or H2 at the start of the body — the website renders the title separately above the article. Start the body directly with the hook paragraph.
- Use HTML formatting: <h2>, <h3>, <p>, <blockquote>, <ul>, <li>, <strong>, <em>, <a> tags
${ctaInstruction}
- Output ONLY valid JSON — no markdown code fences, no commentary
- CRITICAL: In the "body" field, escape all double quotes inside HTML attributes using \\" so the JSON stays valid. For example: <a href=\\"https://example.com\\">text</a>
- Do NOT include any text before or after the JSON object`;

    const pillarDirective = entry.pillar_topic
      ? `\nContent pillar: ${entry.pillar_topic} — this article ARGUES this pillar. Anchor it in that pillar's framework and signature story from the brand context (see "Content pillars" there). A reader who follows the brand's other channels should recognize the same argument in written form.`
      : "";

    const userPrompt = `Write a full article for this topic:

Title: ${entry.title}
Target keyword: ${entry.target_keyword || "not specified"}
Keyword cluster: ${entry.keyword_cluster || "not specified"}
Intent type: ${entry.intent_type || "informational"}
Priority: ${entry.priority || "medium"}${pillarDirective}

Follow this structure:
1. Hook — provocative statement, vivid anecdote, or counterintuitive claim
2. Problem — name the specific pain the audience feels
3. Failed solutions — why what they've tried hasn't worked
4. The reframe — shift their perspective on the real problem
5. The framework/solution — present the systematic approach
6. Proof — reference relevant case studies or testimonials from the brand context
7. CTA — tie to one of the brand's offers (matched by topic relevance)

SEO requirements:
- Integrate target keyword 3-5 times naturally
- Use descriptive H2 headings (2-3 as direct questions)
- Include the target keyword in the first paragraph and one H2
- Include 2-3 internal links to existing articles where relevant, using the exact canonical paths from the list above (e.g. <a href="/blog/slug">text</a>)

FAQ section:
- After the CTA, add an FAQ section with 4-6 questions and answers
- Questions should be ones a reader would naturally ask after reading the article
- Answers should be 2-3 sentences each, direct and helpful
- Include the target keyword naturally in at least 2 FAQ answers
- Format as HTML: <h2>Frequently Asked Questions</h2> followed by <h3>question</h3><p>answer</p> pairs
- Also return the FAQs as structured data in the "faqs" field for JSON-LD schema

Return a JSON object with EXACTLY these fields:
{
  "title": "article title",
  "slug": "url-safe-slug",
  "body": "full HTML article body including FAQ section at the end",
  "excerpt": "150-200 character excerpt",
  "pull_quote": "the article's single most quotable line: a SHORT declarative statement, 8-14 words, punchy enough to stand alone on a poster. A claim, not an instruction — never starts with 'Learn' or 'Discover', no em dashes.",
  "semantic_tags": ["tag1", "tag2", "tag3"],
  "target_segments": ["segment1"],
  "content_type": "article",
  "image_concept": "one sentence describing a monumental, surreal SCENE that embodies THIS article's core argument as a world (not an object on a table) — epic scale, a clear focal structure, room for dramatic light. Derive it from the argument, not the keyword. No text, no faces, no documents, charts or screens.",
  "faqs": [{"question": "Q1?", "answer": "A1"}, {"question": "Q2?", "answer": "A2"}],
  "seo": {
    "title": "SEO meta title under 60 chars",
    "description": "meta description under 160 chars",
    "target_keyword": "primary keyword",
    "secondary_keywords": ["kw1", "kw2", "kw3"],
    "keyword_cluster": "cluster name",
    "schema_type": "Article"
  }
}`;

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 16384,
      messages: [{ role: "user", content: userPrompt }],
      system: systemPrompt,
    });

    // 6. Parse the response
    const responseText =
      message.content[0].type === "text" ? message.content[0].text : "";

    // Extract JSON from response (handle potential markdown wrapping)
    let articleData!: {
      title: string;
      slug: string;
      body: string;
      excerpt: string;
      semantic_tags: string[];
      target_segments: string[];
      content_type: string;
      image_concept?: string;
      pull_quote?: string;
      faqs?: { question: string; answer: string }[];
      seo: {
        title: string;
        description: string;
        target_keyword: string;
        secondary_keywords: string[];
        keyword_cluster: string;
        schema_type: string;
      };
    };

    try {
      // Step 1: Sanitize control characters that break JSON.parse
      // Replace ALL control chars (including newlines/tabs) with a space —
      // literal newlines inside JSON string values are invalid and cause parse errors
      const sanitizedCtrl = responseText.replace(/[\x00-\x1F\x7F]/g, " ");

      // Step 2: Repair unescaped double quotes inside string values
      // Claude sometimes outputs <a href="url"> inside JSON strings without
      // escaping the quotes — this fixes them before any parse attempt
      const sanitized = repairJsonQuotes(sanitizedCtrl);

      // Strategy 1: Try parsing the full response as JSON directly
      let parsed = false;
      try {
        articleData = JSON.parse(sanitized.trim());
        parsed = true;
      } catch {
        // Not pure JSON, try extraction
      }

      // Strategy 2: Extract JSON from markdown code fences
      if (!parsed) {
        const fenceMatch = sanitized.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
        if (fenceMatch) {
          try {
            articleData = JSON.parse(fenceMatch[1]);
            parsed = true;
          } catch {
            // Fenced JSON also invalid
          }
        }
      }

      // Strategy 3: Find the outermost JSON object by bracket matching
      if (!parsed) {
        const startIdx = sanitized.indexOf("{");
        if (startIdx === -1) throw new Error("No JSON found in response");

        let depth = 0;
        let endIdx = -1;
        let inString = false;
        let escapeNext = false;

        for (let i = startIdx; i < sanitized.length; i++) {
          const char = sanitized[i];
          if (escapeNext) { escapeNext = false; continue; }
          if (char === "\\") { escapeNext = true; continue; }
          if (char === '"') { inString = !inString; continue; }
          if (inString) continue;
          if (char === "{") depth++;
          if (char === "}") { depth--; if (depth === 0) { endIdx = i; break; } }
        }

        if (endIdx === -1) throw new Error("No complete JSON object found in response");
        articleData = JSON.parse(sanitized.slice(startIdx, endIdx + 1));
        parsed = true;
      }

      if (!parsed) throw new Error("Could not parse JSON from AI response");
    } catch (parseError: unknown) {
      // Revert status
      await supabase
        .from("content_calendar")
        .update({ status: "approved" })
        .eq("id", calendar_entry_id);
      return NextResponse.json(
        {
          error: `Failed to parse AI response: ${parseError instanceof Error ? parseError.message : "unknown"}`,
        },
        { status: 500 }
      );
    }

    // 7. Generate hero image (non-blocking — article still saves if this fails)
    const heroImageUrl = await generateHeroImage(
      articleData.title,
      entry.target_keyword || articleData.semantic_tags?.[0] || "business technology",
      articleData.slug,
      brand.imageStyle,
      articleData.image_concept
    );

    // 8. Save via Frontend API
    const publishPayload = {
      slug: articleData.slug,
      title: articleData.title,
      // The pull quote lives in `subtitle` — sites can render it as a quote tile.
      subtitle: articleData.pull_quote || null,
      body: articleData.body,
      excerpt: articleData.excerpt,
      content_type: articleData.content_type || "article",
      semantic_tags: articleData.semantic_tags || [],
      target_segments: articleData.target_segments || [],
      featured_image_url: heroImageUrl,
      status: targetStatus,
      created_by: "content_agent",
      author_name: brand.authorName,
      seo: {
        ...articleData.seo,
        og_image_url: heroImageUrl,
        // Include FAQs in SEO meta for FAQPage JSON-LD schema
        ...(articleData.faqs?.length ? { faqs: articleData.faqs } : {}),
      },
    };

    let articleResult: { id?: string; slug?: string } | null = null;

    const publishRes = await frontendFetch("/api/content", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
      },
      body: JSON.stringify(publishPayload),
    });

    if (!publishRes.ok) {
      // Try with modified slug if duplicate
      const errData = await publishRes.json().catch(() => ({}));
      if (
        publishRes.status === 409 ||
        (errData.error && errData.error.includes("duplicate"))
      ) {
        publishPayload.slug = `${articleData.slug}-${Date.now().toString(36).slice(-4)}`;
        const retryRes = await frontendFetch("/api/content", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": API_KEY,
          },
          body: JSON.stringify(publishPayload),
        });
        if (retryRes.ok) {
          articleResult = await retryRes.json();
        }
      }

      if (!articleResult) {
        // Revert status
        await supabase
          .from("content_calendar")
          .update({ status: "approved" })
          .eq("id", calendar_entry_id);
        return NextResponse.json(
          {
            error: "Failed to save article via Frontend API",
            debug: {
              frontend_url: FRONTEND_URL,
              status: publishRes.status,
              statusText: publishRes.statusText,
              response: errData,
            },
          },
          { status: 500 }
        );
      }
    } else {
      articleResult = await publishRes.json();
    }

    // 8. Update calendar entry
    await supabase
      .from("content_calendar")
      .update({
        status: targetStatus,
        content_object_id: articleResult?.id || null,
      })
      .eq("id", calendar_entry_id);

    // 9. Log the action (non-blocking)
    frontendFetch("/api/agent-logs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
      },
      body: JSON.stringify({
        agent: "content_agent",
        action: "write_article",
        description: `Wrote article: ${articleData.title}`,
        status: "completed",
        target_table: "content_objects",
        target_id: articleResult?.id,
        input_data: {
          ...triggerSource,
          calendar_entry_id,
          requested_publish_mode: publish_mode || null,
        },
        output_data: {
          title: articleData.title,
          slug: publishPayload.slug,
          word_count: articleData.body.split(/\s+/).length,
          publishing_mode: publishMode,
          calendar_id: calendar_entry_id,
        },
      }),
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      article: {
        title: articleData.title,
        slug: publishPayload.slug,
        status: targetStatus,
        word_count: articleData.body.split(/\s+/).length,
      },
      mode: publishMode,
    });
  } catch (error) {
    // Revert calendar status on any failure
    await supabase
      .from("content_calendar")
      .update({ status: "approved" })
      .eq("id", calendar_entry_id);

    return NextResponse.json(
      {
        error: `Article writing failed: ${error instanceof Error ? error.message : "unknown error"}`,
      },
      { status: 500 }
    );
  }
}
