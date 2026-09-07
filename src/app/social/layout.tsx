import type { ReactNode } from "react";
import { socialPublishingEnabled } from "@/lib/social/feature";

export const dynamic = "force-dynamic";

export default function SocialLayout({ children }: { children: ReactNode }) {
  if (socialPublishingEnabled(process.env.SOCIAL_PUBLISHING_ENABLED)) return children;
  return (
    <section className="mx-auto max-w-3xl px-6 py-16">
      <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-2xl font-semibold tracking-tight">Your social media calendar</h1>
        <p className="mt-3 text-zinc-600 dark:text-zinc-300">Schedule content for automatic publishing to your connected social accounts.</p>
        <p className="mt-6 text-zinc-600 dark:text-zinc-300">You’ve left this feature off for now. Ask Simon, your Digital Home Manager, to activate it whenever you’re ready.</p>
      </div>
    </section>
  );
}
