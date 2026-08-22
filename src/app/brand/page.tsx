/**
 * /brand — the playbook shelf. Layout follows the Studio board list.
 * Add playbooks in brand/playbooks/index.ts.
 */
import Link from 'next/link';
import { PLAYBOOKS } from '../../../brand/playbooks';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function BrandIndexPage() {
  return (
    <div className="flex-1 overflow-y-auto">
      <header className="px-12 pt-10 pb-6 flex items-center">
        <div>
          <h1 className="text-xl font-medium">Brand playbooks</h1>
          <p className="text-sm text-minimal-muted mt-1">
            Every playbook you have run, newest first.
          </p>
        </div>
      </header>

      <div className="px-12 pb-12 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 max-w-6xl">
        {PLAYBOOKS.length === 0 && (
          <div className="text-sm text-minimal-muted border border-dashed border-minimal-border rounded-lg p-8 text-center col-span-full">
            No playbooks yet. Ask your brand strategist to run your research.
          </div>
        )}
        {PLAYBOOKS.map(({ slug, playbook }, i) => {
          const angle = playbook.offerCore?.programNameOptions?.[0];
          return (
          <Link
            key={slug}
            href={`/brand/${slug}`}
            className="group relative text-left rounded-lg border border-minimal-border bg-minimal-row p-5 hover:border-black/40 dark:hover:border-white/40 transition-colors cursor-pointer"
          >
            {i === 0 && (
              <span className="absolute top-4 right-4 text-[10px] font-semibold text-black bg-white rounded-full px-2 py-0.5">
                CURRENT
              </span>
            )}
            <div className="text-[15px] font-medium pr-20">
              {angle?.name ?? playbook.meta.client}
            </div>
            <div className="text-[11px] text-minimal-muted mt-2">
              Generated {fmtDate(playbook.meta.generatedAt)}
            </div>
          </Link>
          );
        })}
      </div>
    </div>
  );
}
