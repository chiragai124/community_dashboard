import type { Metadata } from 'next';
import './globals.css';
import { Sidebar } from '@/components/Sidebar';
import { COMMUNITIES, GROUPS } from '@/lib/groups';
import { storeBackendLabel } from '@/lib/store';
import { getChatImports } from '@/lib/whatsapp/store';
import type { GroupChatImport } from '@/lib/whatsapp/store';
import type { CommunitySlug, GroupSlug } from '@/lib/types';

export const metadata: Metadata = {
  title: 'amber Communities · Engagement dashboard',
  description:
    'Engagement and lead performance across amber’s WhatsApp communities: the five destination groups, the 2026 intake cohort, and both combined.',
};

/**
 * Each group's most recent member count, for the sidebar.
 *
 * From the chat export, and null until one is uploaded — or when the export
 * doesn't reach the group's creation, since without that there is no baseline to
 * count up from.
 */
function latestMemberCount(imports: GroupChatImport[], group: GroupSlug): number | null {
  const record = imports.find((r) => r.group === group);
  if (!record) return null;
  const latest = [...record.weeks]
    .filter((w) => w.members !== null)
    .sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1))[0];
  return latest?.members ?? null;
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const chatImports = await getChatImports();

  const memberCounts: Partial<Record<GroupSlug, number | null>> = {};
  for (const group of GROUPS) {
    memberCounts[group.slug] = latestMemberCount(chatImports, group.slug);
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
