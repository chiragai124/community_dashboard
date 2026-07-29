import type { Metadata } from 'next';
import './globals.css';
import { Sidebar } from '@/components/Sidebar';
import { COMMUNITIES, GROUPS } from '@/lib/groups';
import { getEntries, storeBackendLabel } from '@/lib/store';
import type { CommunitySlug, GroupSlug, WeeklyEntry } from '@/lib/types';

export const metadata: Metadata = {
  title: 'amber Communities · Engagement dashboard',
  description:
    'Engagement and lead performance across amber’s WhatsApp communities: the five destination groups, the 2026 intake cohort, and both combined.',
};

/** Each group's most recent recorded member count, for the sidebar. */
function latestMemberCount(entries: WeeklyEntry[], group: GroupSlug): number | null {
  const latest = entries
    .filter((e) => e.group === group)
    .sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1))[0];
  return latest ? latest.totalMembers : null;
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const entries = await getEntries();

  const memberCounts: Partial<Record<GroupSlug, number | null>> = {};
  for (const group of GROUPS) {
    memberCounts[group.slug] = latestMemberCount(entries, group.slug);
  }

  // Pooled per community, so the switcher shows each community's size.
  const communityMembers: Partial<Record<CommunitySlug, number>> = {};
  for (const community of COMMUNITIES) {
    communityMembers[community.slug] = community.groups.reduce(
      (sum, g) => sum + (memberCounts[g.slug] ?? 0),
      0,
    );
  }

  return (
    <html lang="en">
      <body>
        <a className="skipLink" href="#main">
          Skip to content
        </a>
        <div className="shell">
          <Sidebar
            memberCounts={memberCounts}
            communityMembers={communityMembers}
            backendLabel={storeBackendLabel()}
          />
          <div className="main" id="main">
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
