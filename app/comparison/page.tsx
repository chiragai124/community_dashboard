import { redirect } from 'next/navigation';
import { DEFAULT_COMMUNITY } from '@/lib/groups';

/** Legacy URL — the comparison view is now per community. */
export default function LegacyComparisonPage() {
  redirect(`/c/${DEFAULT_COMMUNITY}/comparison`);
}
