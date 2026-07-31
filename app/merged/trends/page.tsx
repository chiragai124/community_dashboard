import { PageHeader } from '@/components/PageHeader';
import { TrendsView, type TrendMetric } from '@/components/TrendsView';
import { COMMUNITIES } from '@/lib/groups';
import { loadDashboard, multiCommunityRows, perCommunityTotals } from '@/lib/dashboard';
import { METRIC_DEFS } from '@/lib/metrics';
import type { MultiRow } from '@/components/charts';

export const dynamic = 'force-dynamic';

/**
 * Trends at community level: one series per community, each the pooled value of
 * its groups. Counts sum; rates are recomputed from their own numerators and
 * denominators for each week rather than averaged.
 */
export default async function MergedTrendsPage() {
  const data = await loadDashboard();

  const metrics: TrendMetric[] = METRIC_DEFS.map((def) => ({
    key: def.key,
    label: def.shortLabel,
    unit: def.unit,
    description: `${def.description} — pooled per community`,
  }));

  const rowsByMetric: Record<string, MultiRow[]> = {};
  for (const def of METRIC_DEFS) {
    rowsByMetric[def.key] = multiCommunityRows(data, def.key) as MultiRow[];
  }

  const series = COMMUNITIES.map((c) => ({ key: c.slug, label: c.label }));
  const biggest = [...perCommunityTotals(data)].sort(
    (a, b) => (b.totals.members ?? 0) - (a.totals.members ?? 0),
  )[0];

  return (
    <>
      <PageHeader
        eyebrow="Merged · All communities"
        title="Trends by community"
        weekStart={data.displayWeek}
        weekCaption="Window ends"
      />

      <div className="content">
        <TrendsView
          metrics={metrics}
          rowsByMetric={rowsByMetric}
          series={series}
          defaultGroup={biggest?.community ?? COMMUNITIES[0].slug}
          seriesNoun="communities"
        />
      </div>
    </>
  );
}
