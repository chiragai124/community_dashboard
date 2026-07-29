import { PageHeader } from '@/components/PageHeader';
import { TrendsView, type TrendMetric } from '@/components/TrendsView';
import { DemoNotice } from '@/components/DemoNotice';
import { GROUPS } from '@/lib/groups';
import { loadDashboard, multiGroupRows } from '@/lib/dashboard';
import { METRIC_DEFS } from '@/lib/metrics';
import type { MultiRow } from '@/components/charts';

export const dynamic = 'force-dynamic';

export default async function TrendsPage() {
  const data = await loadDashboard();

  const metrics: TrendMetric[] = METRIC_DEFS.map((def) => ({
    key: def.key,
    label: def.shortLabel,
    unit: def.unit,
    description: def.description,
  }));

  // Precompute every metric's full window once, so the client can switch metric,
  // view and window with no round-trip.
  const rowsByMetric: Record<string, MultiRow[]> = {};
  for (const def of METRIC_DEFS) {
    rowsByMetric[def.key] = multiGroupRows(data, def.key) as MultiRow[];
  }

  const series = GROUPS.map((group) => ({ key: group.slug, label: group.label }));
  const biggest = [...data.perGroup].sort(
    (a, b) => (b.totalMembers ?? 0) - (a.totalMembers ?? 0),
  )[0];

  return (
    <>
      <PageHeader
        eyebrow="Trends"
        title="Metrics over time"
        weekStart={data.displayWeek}
        weekCaption="Window ends"
        states={data.snapshot.states}
        fetchedAt={data.snapshot.fetchedAt}
      />

      <div className="content">
        <DemoNotice snapshot={data.snapshot} demoEntries={data.demoEntries} />
        <TrendsView
          metrics={metrics}
          rowsByMetric={rowsByMetric}
          series={series}
          defaultGroup={biggest?.group ?? GROUPS[0].slug}
        />
      </div>
    </>
  );
}
