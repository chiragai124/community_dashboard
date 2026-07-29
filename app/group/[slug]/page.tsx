import { notFound, redirect } from 'next/navigation';
import { getGroup } from '@/lib/groups';

/**
 * Legacy URL. Group pages moved under their community when the second community
 * was added; this keeps bookmarks and any shared links working.
 */
export default async function LegacyGroupPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const group = getGroup(slug);
  if (!group) notFound();
  redirect(`/c/${group.community}/group/${group.slug}`);
}
