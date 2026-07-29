import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { TrendsView, type TrendMetric } from '@/components/TrendsView';
import { DemoNotice } from '@/components/DemoNotice';
import { getCommunity, integrationsFor } from '@/lib/groups';
import { groupsInCommunity, loadDashboard, multiGroupRows } from '@/lib/dashboard';
import { METRIC_DEFS } from '@/lib/metrics';
import type { MultiRow } from '@/components/charts';

export const dynamic = 'force-dynamic';

export default async function CommunityTrendsPage({
  params,
}: {
  params: Promise<{ community: string }>;
}) {
  const { community: communitySlug } = await params;
  const community = getCommunity(communitySlug);
  if (!community) notFound();

  const data = await loadDashboard();
  const slugs = community.groups.map((g) => g.slug);
  const sources = integrationsFor(community.slug);
  const hasSources = sources.length > 0;

  // Only offer metrics whose source actually covers this community — a
  // manual-only community gets no Leads or Sessions toggles at all.
  const defs = METRIC_DEFS.filter((def) => !def.requires || sources.includes(def.requires));

  const metrics: TrendMetric[] = defs.map((def) => ({
    key: def.key,
    label: def.shortLabel,
    unit: def.unit,
    description: def.description,
  }));

  // Precompute every metric's full window once, so the client can switch metric,
  // view and window with no round-trip.
  const rowsByMetric: Record<string, MultiRow[]> = {};
  for (const def of defs) {
    rowsByMetric[def.key] = multiGroupRows(data, def.key, slugs) as MultiRow[];
  }

  const series = community.groups.map((group) => ({ key: group.slug, label: group.label }));
  const biggest = [...groupsInCommunity(data, community.slug)].sort(
    (a, b) => (b.totalMembers ?? 0) - (a.totalMembers ?? 0),
  )[0];

  return (
    <>
      <PageHeader
        eyebrow={`${community.label} · Trends`}
        title="Metrics over time"
        weekStart={data.displayWeek}
        weekCaption="Window ends"
        states={hasSources ? data.snapshot.states : []}
        fetchedAt={data.snapshot.fetchedAt}
      />

      <div className="content">
        <DemoNotice
          snapshot={data.snapshot}
          demoEntries={data.demoEntries}
          sources={hasSources}
        />
        <TrendsView
          metrics={metrics}
          rowsByMetric={rowsByMetric}
          series={series}
          defaultGroup={biggest?.group ?? slugs[0]}
          seriesNoun={community.groupNoun.toLowerCase()}
        />
      </div>
    </>
  );
}
