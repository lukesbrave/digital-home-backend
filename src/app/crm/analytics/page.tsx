import { Suspense } from 'react';
import AnalyticsShell from '@/components/analytics/shell';
export default function AnalyticsPage(){return <Suspense fallback={<p role="status">Loading analytics…</p>}><AnalyticsShell/></Suspense>;}
