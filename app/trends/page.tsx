import { redirect } from 'next/navigation';
import { DEFAULT_COMMUNITY } from '@/lib/groups';

/** Legacy URL — the trends view is now per community, plus a merged variant. */
export default function LegacyTrendsPage() {
  redirect(`/c/${DEFAULT_COMMUNITY}/trends`);
}
