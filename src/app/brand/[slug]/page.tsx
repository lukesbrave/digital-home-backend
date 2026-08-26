/**
 * /brand/<slug> — one playbook, read end to end.
 *
 * Header follows the detail-page convention (see crm/leads/[id]): the way
 * back is a named link on the left, not an action on the right.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PlaybookView } from '@/components/brand/playbook-view';
import { getBrandPlaybook } from '@/lib/brand/playbook-store';

export const dynamic = 'force-dynamic';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default async function BrandPlaybookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const playbook = await getBrandPlaybook(slug);
  if (!playbook) notFound();

  return (
    <div className="flex flex-col h-full">
      <header className="h-20 px-12 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-6 min-w-0">
          <Link href="/brand" className="text-xs text-minimal-muted hover:text-white shrink-0">
            ← Playbooks
          </Link>
          <h1 className="text-lg font-semibold text-white truncate">Brand playbook</h1>
        </div>
        <span className="text-xs text-minimal-muted shrink-0">
          Generated {fmtDate(playbook.meta.generatedAt)}
        </span>
      </header>
      <PlaybookView playbook={playbook} />
    </div>
  );
}
