import { redirect } from 'next/navigation';
import { DEFAULT_COMMUNITY } from '@/lib/groups';

/**
 * The dashboard has no single "all communities" home — it has three scopes. "/"
 * lands on the first community, which is where the existing report lives.
 */
export default function RootPage() {
  redirect(`/c/${DEFAULT_COMMUNITY}`);
}
