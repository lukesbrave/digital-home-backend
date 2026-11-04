import { redirect } from 'next/navigation';
import { legacyFunnelUrl } from '@/lib/analytics/selection';
export default async function LegacyFunnel({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  redirect(legacyFunnelUrl(await searchParams));
}
