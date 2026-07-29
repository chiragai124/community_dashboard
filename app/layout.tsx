import type { Metadata } from 'next';
import './globals.css';
import { Sidebar } from '@/components/Sidebar';
import { GROUPS } from '@/lib/groups';
import { getEntries, storeBackendLabel } from '@/lib/store';
import type { GroupSlug } from '@/lib/types';

export const metadata: Metadata = {
  title: 'amber Communities · Engagement dashboard',
  description:
    'Engagement and lead performance across amber’s five WhatsApp communities: UK, USA, Australia, Canada and Germany.',
};

/** Latest recorded member count per group, for the sidebar. */
async function latestMemberCounts(): Promise<Partial<Record<GroupSlug, number | null>>> {
  const entries = await getEntries();
  const counts: Partial<Record<GroupSlug, number | null>> = {};
  for (const group of GROUPS) {
    const latest = entries
      .filter((e) => e.group === group.slug)
      .sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1))[0];
    counts[group.slug] = latest ? latest.totalMembers : null;
  }
  return counts;
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [memberCounts] = await Promise.all([latestMemberCounts()]);

  return (
    <html lang="en">
      <body>
        <a className="skipLink" href="#main">
          Skip to content
        </a>
        <div className="shell">
          <Sidebar memberCounts={memberCounts} backendLabel={storeBackendLabel()} />
          <div className="main" id="main">
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
