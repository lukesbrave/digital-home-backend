/**
 * The playbook shelf.
 *
 * Your Digital Home ships with no brand research — this shelf is empty
 * until your brand strategist runs it. When it does, it writes your
 * research to `brand/playbook.json` and that path becomes the current
 * playbook and the first entry here. Nothing to wire by hand.
 *
 * `brand/playbook.json` is a contract: your employees read it by name, so
 * it stays at that path and never moves into this folder.
 *
 * TO ARCHIVE A PLAYBOOK AND RUN NEW RESEARCH:
 *   1. Copy `brand/playbook.json` to `brand/playbooks/<YYYY-MM-DD>-<name>.json`,
 *      import it below, and add it to PLAYBOOKS under the current entry.
 *   2. Let the strategist write the new research to `brand/playbook.json`.
 *
 * Shape: `brand/playbook.schema.json` for sections 1-9, plus the optional
 * `narrative` block (standingCopyRules, proofAsset, knownGaps, neverSay)
 * carrying sections 10-12, so each playbook is self-contained.
 *
 * Old playbooks are never edited or deleted — the shelf is the record of
 * how your thinking changed over time.
 */
import current from '../playbook.json';

export type NarrativeNote = { title: string; body: string };
type Quote = { text: string; source: string; url?: string };
type Complaint = { quote: string; source: string; url?: string };
type Place = {
  name: string;
  platform?: string;
  size?: string;
  relevance: string;
  exampleTopics?: string[];
  howToAccess?: string;
};
type PlatformRec = {
  platform: string;
  reasoning: string;
  contentFormats: string[];
  postingCadence?: string;
};

/** Sections 1-9 follow brand/playbook.schema.json; 10-12 are `narrative`. */
export type Playbook = {
  meta: {
    client: string;
    generatedAt: string;
    version: string;
    selectedAudience: { title: string; description: string };
    sources?: { brief?: string; transcripts?: string[] };
  };
  audienceResearch: {
    audienceState: { currentState: string; desiredState: string };
    urgencyGateway: {
      problem: string;
      whyUrgent: string;
      failedSolutions: string[];
      aspirinSolution: string;
    };
    painPoints: {
      pain: string;
      severity: string;
      emotionalContext: string;
      realQuotes?: Quote[];
    }[];
    languageMap: {
      painPhrases: string[];
      desirePhrases: string[];
      searchPhrases: { phrase: string; estimatedDemand: string; context?: string }[];
      emotionalTriggers: string[];
    };
    congregationPoints: {
      tier1_mainstream: Place[];
      tier2_niche: Place[];
      tier3_micro: Place[];
    };
    marketingRecommendation: {
      primaryPlatform: PlatformRec;
      secondaryPlatforms?: PlatformRec[];
      contentStrategyTips: string[];
      quickWin: string;
    };
    competitiveLandscape: {
      existingSolutions: {
        name: string;
        url?: string;
        positioning: string;
        pricing?: string;
        complaints?: Complaint[];
        strengths?: string[];
        weaknesses?: string[];
      }[];
      marketGaps: string[];
      positioningOpportunities: string[];
    };
  };
  offerCore: {
    offerStatement: { finalStatement: string; emotionalCore?: string };
    theOfferGivesYou: string[];
    youCanUseItTo: string[];
    hiddenBenefits: string[];
    programNameOptions: { name: string; uniqueMechanism: string; rationale: string }[];
  };
  narrative?: {
    standingCopyRules?: NarrativeNote[];
    proofAsset?: { body: string; caution?: string };
    knownGaps?: NarrativeNote[];
    neverSay?: string[];
  };
};

export type PlaybookEntry = { slug: string; playbook: Playbook };

/**
 * `brand/playbook.json` is an empty object until the strategist fills it,
 * so the shelf only lists it once it holds real research.
 */
function isPlaybook(value: unknown): value is Playbook {
  return (
    !!value &&
    typeof value === 'object' &&
    !!(value as Playbook).meta?.client &&
    !!(value as Playbook).audienceResearch
  );
}

/** Newest first — the order the shelf is read in. */
export const PLAYBOOKS: PlaybookEntry[] = [
  ...(isPlaybook(current) ? [{ slug: 'current', playbook: current }] : []),
  // Archived playbooks go here, newest first:
  // { slug: '2026-08-19-acme', playbook: acme20260819 as unknown as Playbook },
];

export function getPlaybook(slug: string): Playbook | undefined {
  return PLAYBOOKS.find((p) => p.slug === slug)?.playbook;
}

/** The most recent playbook — what /brand opens to when there is only one. */
export const LATEST: PlaybookEntry | undefined = PLAYBOOKS[0];
