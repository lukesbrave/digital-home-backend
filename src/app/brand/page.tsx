import playbook from '../../../brand/playbook.json';
import { PageHeader } from '@/components/crm/kit';

// brand/playbook.json ships with example data for a fictional business.
// Replace it with the playbook your brand research produces (it must match
// brand/playbook.schema.json, which covers sections 1-9 of this page).
//
// Sections 10-12 below are narrative-only: they live in these constants,
// not in the JSON schema. Edit them by hand to match your own playbook's
// copy rules, proof asset, and known gaps.
const STANDING_COPY_RULES = [
  {
    title: 'Lead with the outcome, not the product.',
    body: 'Example rule. Your playbook records the rules that govern every ad, page, and post you publish.',
  },
  {
    title: 'Use the audience\u2019s words from the language map.',
    body: 'Example rule. Plain language the audience actually uses beats clinical or clever phrasing.',
  },
  {
    title: 'Say what it is and what it does for them.',
    body: 'Example rule. Never define the offer by what it is not.',
  },
];

const PROOF_ASSET = {
  body: 'Example proof asset. This section holds the single strongest piece of verifiable evidence behind the offer: a live system, a real number, a named result. Real or absent; never invented.',
  caution: 'Numbers move. Re-check any figure before quoting it publicly, and cite it as current-as-of a date.',
};

const KNOWN_GAPS = [
  {
    title: 'Example gap: one research channel was not reachable.',
    body: 'The real playbook lists what the research could not cover, so nobody mistakes silence for evidence.',
  },
  {
    title: 'Example gap: a small sample behind one claim.',
    body: 'Directional findings are marked as directional until the base grows.',
  },
];

const NEVER_SAY = ['unlock', 'leverage', 'scale infinitely', 'game-changing', 'revolutionary'];

const SECTIONS = [
  { id: 'audience', label: 'Audience' },
  { id: 'transformation', label: 'Transformation' },
  { id: 'urgency', label: 'Urgency gateway' },
  { id: 'pain-points', label: 'Pain points' },
  { id: 'language', label: 'Language map' },
  { id: 'gather', label: 'Where they gather' },
  { id: 'marketing', label: 'Marketing rec' },
  { id: 'competitive', label: 'Competitive landscape' },
  { id: 'offer', label: 'The offer' },
  { id: 'copy-rules', label: 'Standing copy rules' },
  { id: 'proof', label: 'Proof asset' },
  { id: 'gaps', label: 'Known gaps' },
] as const;

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', { year: 'numeric', month: 'long', day: 'numeric' });
}

function Section({ id, title, number, children }: { id: string; title: string; number: number; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 py-12 border-t border-minimal-border first:border-t-0 first:pt-0">
      <div className="flex items-baseline gap-3 mb-6">
        <span className="text-xs font-mono text-minimal-muted">{String(number).padStart(2, '0')}</span>
        <h2 className="text-xl font-semibold text-white">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`border border-minimal-border rounded-lg p-5 ${className}`}>{children}</div>;
}

function PhraseList({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((p) => (
        <span key={p} className="text-[13px] text-zinc-300 border border-minimal-border rounded-full px-3 py-1">
          {p}
        </span>
      ))}
    </div>
  );
}

function SourceLink({ source, url }: { source: string; url?: string }) {
  if (!url) return <span className="text-xs text-minimal-muted">{source}</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-minimal-muted underline decoration-dotted hover:text-zinc-300">
      {source} ↗
    </a>
  );
}

export default function BrandPage() {
  const { meta, audienceResearch, offerCore } = playbook;
  const critical = audienceResearch.painPoints.filter((p) => p.severity === 'critical');
  const moderate = audienceResearch.painPoints.filter((p) => p.severity !== 'critical');

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Brand playbook">
        <span className="text-xs text-minimal-muted">Generated {fmtDate(meta.generatedAt)}</span>
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        {/* Hero */}
        <div className="px-12 py-14 border-b border-minimal-border">
          <p className="text-xs font-mono text-minimal-muted mb-4">{meta.client} · v{meta.version}</p>
          <p className="text-3xl md:text-4xl font-semibold text-white leading-tight max-w-4xl text-balance">
            {offerCore.offerStatement.finalStatement}
          </p>
          <div className="flex flex-wrap items-center gap-3 mt-6">
            {offerCore.programNameOptions.slice(0, 1).map((p) => (
              <span key={p.name} className="text-xs font-medium text-white border border-minimal-border rounded-full px-3 py-1.5">
                {p.name} · {p.uniqueMechanism}
              </span>
            ))}
            <span className="text-xs text-minimal-muted">
              Data as of {fmtDate(meta.generatedAt)} — figures move, re-check before quoting publicly.
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-10 px-12">
          {/* Section nav */}
          <nav className="hidden lg:block sticky top-6 self-start pt-12 pb-12">
            <ul className="space-y-1">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="block text-[13px] text-minimal-muted hover:text-white py-1 transition-colors">
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          {/* Content */}
          <div className="max-w-3xl pb-24">
            <Section id="audience" number={1} title="The audience">
              <p className="text-[15px] text-zinc-200 font-medium mb-3">{audienceResearch.audienceState ? playbook.meta.selectedAudience.title : ''}</p>
              <p className="text-sm text-zinc-400 leading-relaxed">{playbook.meta.selectedAudience.description}</p>
            </Section>

            <Section id="transformation" number={2} title="The transformation">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <p className="text-xs font-semibold text-minimal-muted uppercase tracking-wide mb-2">Current state</p>
                  <p className="text-sm text-zinc-300 leading-relaxed">{audienceResearch.audienceState.currentState}</p>
                </Card>
                <Card>
                  <p className="text-xs font-semibold text-minimal-muted uppercase tracking-wide mb-2">Desired state</p>
                  <p className="text-sm text-zinc-300 leading-relaxed">{audienceResearch.audienceState.desiredState}</p>
                </Card>
              </div>
            </Section>

            <Section id="urgency" number={3} title="The urgency gateway">
              <p className="text-sm text-zinc-300 leading-relaxed mb-2">{audienceResearch.urgencyGateway.problem}</p>
              <p className="text-sm text-zinc-400 leading-relaxed mb-6">{audienceResearch.urgencyGateway.whyUrgent}</p>

              <p className="text-xs font-semibold text-minimal-muted uppercase tracking-wide mb-2">What already failed</p>
              <ul className="space-y-1.5 mb-6">
                {audienceResearch.urgencyGateway.failedSolutions.map((f) => (
                  <li key={f} className="text-sm text-zinc-400 flex gap-2">
                    <span className="text-minimal-muted">·</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <Card className="bg-minimal-row">
                <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wide mb-2">The aspirin</p>
                <p className="text-sm text-zinc-200 leading-relaxed">{audienceResearch.urgencyGateway.aspirinSolution}</p>
              </Card>
            </Section>

            <Section id="pain-points" number={4} title="Pain points">
              <p className="text-xs font-semibold text-red-400 uppercase tracking-wide mb-3">Critical</p>
              <div className="space-y-4 mb-8">
                {critical.map((p) => (
                  <Card key={p.pain}>
                    <p className="text-sm font-medium text-zinc-100 mb-1.5">{p.pain}</p>
                    <p className="text-sm text-zinc-400 leading-relaxed mb-3">{p.emotionalContext}</p>
                    {p.realQuotes?.map((q) => (
                      <div key={q.text} className="border-l-2 border-minimal-border pl-3 mt-2">
                        <p className="text-[13px] text-zinc-300 italic mb-1">&ldquo;{q.text}&rdquo;</p>
                        <SourceLink source={q.source} url={q.url} />
                      </div>
                    ))}
                  </Card>
                ))}
              </div>

              <p className="text-xs font-semibold text-yellow-500 uppercase tracking-wide mb-3">Moderate</p>
              <div className="space-y-4">
                {moderate.map((p) => (
                  <Card key={p.pain}>
                    <p className="text-sm font-medium text-zinc-100 mb-1.5">{p.pain}</p>
                    <p className="text-sm text-zinc-400 leading-relaxed mb-3">{p.emotionalContext}</p>
                    {p.realQuotes?.map((q) => (
                      <div key={q.text} className="border-l-2 border-minimal-border pl-3 mt-2">
                        <p className="text-[13px] text-zinc-300 italic mb-1">&ldquo;{q.text}&rdquo;</p>
                        <SourceLink source={q.source} url={q.url} />
                      </div>
                    ))}
                  </Card>
                ))}
              </div>
            </Section>

            <Section id="language" number={5} title="Language map">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div>
                  <p className="text-xs font-semibold text-minimal-muted uppercase tracking-wide mb-3">They say (pain)</p>
                  <PhraseList items={audienceResearch.languageMap.painPhrases} />
                </div>
                <div>
                  <p className="text-xs font-semibold text-minimal-muted uppercase tracking-wide mb-3">They say (desire)</p>
                  <PhraseList items={audienceResearch.languageMap.desirePhrases} />
                </div>
              </div>

              <Card className="mb-6 border-red-900/40">
                <p className="text-xs font-semibold text-red-400 uppercase tracking-wide mb-2">Never say</p>
                <p className="text-sm text-zinc-300">{NEVER_SAY.join(' · ')}</p>
              </Card>

              <p className="text-xs font-semibold text-minimal-muted uppercase tracking-wide mb-3">Emotional triggers</p>
              <ul className="space-y-1.5 mb-6">
                {audienceResearch.languageMap.emotionalTriggers.map((t) => (
                  <li key={t} className="text-sm text-zinc-400 flex gap-2">
                    <span className="text-minimal-muted">·</span>
                    <span>{t}</span>
                  </li>
                ))}
              </ul>

              <p className="text-xs font-semibold text-minimal-muted uppercase tracking-wide mb-3">Search phrases</p>
              <div className="border border-minimal-border rounded-lg overflow-hidden">
                {audienceResearch.languageMap.searchPhrases.map((s, i) => (
                  <div key={s.phrase} className={`px-4 py-3 ${i > 0 ? 'border-t border-minimal-border' : ''} flex items-center justify-between gap-4`}>
                    <span className="text-sm text-zinc-300">&ldquo;{s.phrase}&rdquo;</span>
                    <span className="text-xs text-minimal-muted shrink-0 uppercase">{s.estimatedDemand}</span>
                  </div>
                ))}
              </div>
            </Section>

            <Section id="gather" number={6} title="Where they gather">
              {(['tier1_mainstream', 'tier2_niche', 'tier3_micro'] as const).map((tier) => (
                <div key={tier} className="mb-6 last:mb-0">
                  <p className="text-xs font-semibold text-minimal-muted uppercase tracking-wide mb-3">
                    {tier === 'tier1_mainstream' ? 'Mainstream' : tier === 'tier2_niche' ? 'Niche' : 'Micro'}
                  </p>
                  <div className="space-y-3">
                    {audienceResearch.congregationPoints[tier].map((c) => (
                      <Card key={c.name}>
                        <p className="text-sm font-medium text-zinc-100 mb-1">{c.name}</p>
                        <p className="text-sm text-zinc-400 leading-relaxed">{c.relevance}</p>
                      </Card>
                    ))}
                  </div>
                </div>
              ))}
            </Section>

            <Section id="marketing" number={7} title="Marketing recommendation">
              <Card className="mb-6 bg-minimal-row">
                <p className="text-xs font-semibold text-minimal-muted uppercase tracking-wide mb-2">Quick win</p>
                <p className="text-sm text-zinc-200 leading-relaxed">{audienceResearch.marketingRecommendation.quickWin}</p>
              </Card>

              <Card className="mb-4">
                <p className="text-sm font-medium text-zinc-100 mb-1">
                  Primary: {audienceResearch.marketingRecommendation.primaryPlatform.platform}
                </p>
                <p className="text-sm text-zinc-400 leading-relaxed mb-3">
                  {audienceResearch.marketingRecommendation.primaryPlatform.reasoning}
                </p>
                <ul className="space-y-1">
                  {audienceResearch.marketingRecommendation.primaryPlatform.contentFormats.map((f) => (
                    <li key={f} className="text-[13px] text-zinc-400 flex gap-2">
                      <span className="text-minimal-muted">·</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </Card>

              <p className="text-xs font-semibold text-minimal-muted uppercase tracking-wide mb-3 mt-6">Content strategy</p>
              <ul className="space-y-1.5">
                {audienceResearch.marketingRecommendation.contentStrategyTips.map((t) => (
                  <li key={t} className="text-sm text-zinc-400 flex gap-2">
                    <span className="text-minimal-muted">·</span>
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </Section>

            <Section id="competitive" number={8} title="Competitive landscape">
              <p className="text-xs font-semibold text-minimal-muted uppercase tracking-wide mb-3">Market gaps</p>
              <ul className="space-y-1.5 mb-8">
                {audienceResearch.competitiveLandscape.marketGaps.map((g) => (
                  <li key={g} className="text-sm text-zinc-300 flex gap-2">
                    <span className="text-emerald-400">·</span>
                    <span>{g}</span>
                  </li>
                ))}
              </ul>

              <p className="text-xs font-semibold text-minimal-muted uppercase tracking-wide mb-3">Positioning opportunities</p>
              <ul className="space-y-1.5 mb-8">
                {audienceResearch.competitiveLandscape.positioningOpportunities.map((g) => (
                  <li key={g} className="text-sm text-zinc-300 flex gap-2">
                    <span className="text-emerald-400">·</span>
                    <span>{g}</span>
                  </li>
                ))}
              </ul>

              <p className="text-xs font-semibold text-minimal-muted uppercase tracking-wide mb-3">Existing solutions</p>
              <div className="space-y-4">
                {audienceResearch.competitiveLandscape.existingSolutions.map((c) => (
                  <Card key={c.name}>
                    <div className="flex items-baseline justify-between gap-3 mb-1">
                      <p className="text-sm font-medium text-zinc-100">{c.name}</p>
                      {c.url && (
                        <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-xs text-minimal-muted hover:text-zinc-300">
                          {c.url.replace(/^https?:\/\//, '')} ↗
                        </a>
                      )}
                    </div>
                    <p className="text-sm text-zinc-400 leading-relaxed mb-3">{c.positioning}</p>
                    {c.complaints?.length > 0 && (
                      <div className="space-y-2">
                        {c.complaints.map((q) => (
                          <div key={q.quote} className="border-l-2 border-minimal-border pl-3">
                            <p className="text-[13px] text-zinc-300 italic mb-1">&ldquo;{q.quote}&rdquo;</p>
                            <SourceLink source={q.source} url={q.url} />
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            </Section>

            <Section id="offer" number={9} title="The offer">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div>
                  <p className="text-xs font-semibold text-minimal-muted uppercase tracking-wide mb-3">The offer gives you</p>
                  <ul className="space-y-1.5">
                    {offerCore.theOfferGivesYou.map((t) => (
                      <li key={t} className="text-sm text-zinc-300 flex gap-2">
                        <span className="text-minimal-muted">·</span>
                        <span>{t}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-semibold text-minimal-muted uppercase tracking-wide mb-3">You can use it to</p>
                  <ul className="space-y-1.5">
                    {offerCore.youCanUseItTo.map((t) => (
                      <li key={t} className="text-sm text-zinc-300 flex gap-2">
                        <span className="text-minimal-muted">·</span>
                        <span>{t}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <p className="text-xs font-semibold text-minimal-muted uppercase tracking-wide mb-3">Hidden benefits</p>
              <p className="text-xs text-minimal-muted mb-3 italic">
                Written as strategy notes (&ldquo;it isn&rsquo;t X, it&rsquo;s Y&rdquo;) — restate positively per copy rule 3 before this goes public.
              </p>
              <div className="space-y-2 mb-8">
                {offerCore.hiddenBenefits.map((h) => (
                  <Card key={h}>
                    <p className="text-sm text-zinc-300 leading-relaxed">{h}</p>
                  </Card>
                ))}
              </div>

              <p className="text-xs font-semibold text-minimal-muted uppercase tracking-wide mb-3">Program name options</p>
              <div className="space-y-3">
                {offerCore.programNameOptions.map((p, i) => (
                  <Card key={p.name} className={i === 0 ? 'border-white/30' : ''}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <p className="text-sm font-medium text-zinc-100">{p.name}</p>
                      {i === 0 && <span className="text-[10px] font-semibold text-black bg-white rounded-full px-2 py-0.5">CHOSEN</span>}
                      <span className="text-xs text-minimal-muted">· {p.uniqueMechanism}</span>
                    </div>
                    <p className="text-sm text-zinc-400 leading-relaxed">{p.rationale}</p>
                  </Card>
                ))}
              </div>
            </Section>

            <Section id="copy-rules" number={10} title="Standing copy rules">
              <p className="text-sm text-zinc-400 leading-relaxed mb-6">
                Set by the founder. These govern every ad, page and carousel from here.
              </p>
              <div className="space-y-3">
                {STANDING_COPY_RULES.map((r, i) => (
                  <Card key={r.title}>
                    <p className="text-sm font-medium text-zinc-100 mb-1">{i + 1}. {r.title}</p>
                    <p className="text-sm text-zinc-400 leading-relaxed">{r.body}</p>
                  </Card>
                ))}
              </div>
            </Section>

            <Section id="proof" number={11} title="The proof asset">
              <p className="text-sm text-zinc-300 leading-relaxed mb-4">{PROOF_ASSET.body}</p>
              <Card className="border-yellow-900/40">
                <p className="text-xs font-semibold text-yellow-500 uppercase tracking-wide mb-2">Caution</p>
                <p className="text-sm text-zinc-300">{PROOF_ASSET.caution}</p>
              </Card>
            </Section>

            <Section id="gaps" number={12} title="Known gaps">
              <div className="space-y-3">
                {KNOWN_GAPS.map((g) => (
                  <Card key={g.title}>
                    <p className="text-sm font-medium text-zinc-100 mb-1">{g.title}</p>
                    <p className="text-sm text-zinc-400 leading-relaxed">{g.body}</p>
                  </Card>
                ))}
              </div>
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}
