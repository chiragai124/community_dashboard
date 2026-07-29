import { PageHeader } from '@/components/PageHeader';
import { ComparisonTable, type ComparisonRow } from '@/components/ComparisonTable';
import { MultiGroupTrend } from '@/components/charts';
import { DemoNotice } from '@/components/DemoNotice';
import { GROUPS } from '@/lib/groups';
import { loadDashboard, multiGroupRows } from '@/lib/dashboard';
import { pct } from '@/lib/metrics';
import { formatWeekRange } from '@/lib/weeks';

export const dynamic = 'force-dynamic';

export default async function ComparisonPage() {
  const data = await loadDashboard();

  const rows: ComparisonRow[] = data.perGroup.map((metrics) => {
    const group = GROUPS.find((g) => g.slug === metrics.group);
    return {
      group: metrics.group,
      label: group?.label ?? metrics.group,
      flag: group?.flag ?? '',
      totalMembers: metrics.totalMembers,
      newMembers: metrics.newMembers,
      memberGrowthPct: metrics.memberGrowthPct,
      pollResponses: metrics.pollResponses,
      pollResponseRatePct: metrics.pollResponseRatePct,
      dmsSent: metrics.dmsSent,
      dmReplies: metrics.dmReplies,
      dmReplyRatePct: metrics.dmReplyRatePct,
      totalLeads: metrics.totalLeads,
      totalSessions: metrics.totalSessions,
      leadConversionPct: pct(metrics.totalLeads, metrics.totalSessions),
      activityLevel: metrics.activityLevel,
      hasEntry: metrics.entry !== null,
    };
  });

  const series = GROUPS.map((group) => ({ key: group.slug, label: group.label }));
  const memberRows = multiGroupRows(data, 'totalMembers');

  // Open the overlay focused on the largest group, so one line is always
  // legible before the reader clicks anything.
  const biggest = [...data.perGroup].sort(
    (a, b) => (b.totalMembers ?? 0) - (a.totalMembers ?? 0),
  )[0];

  return (
    <>
      <PageHeader
        eyebrow="Cross-community"
        title="Comparison"
        weekStart={data.displayWeek}
        states={data.snapshot.states}
        fetchedAt={data.snapshot.fetchedAt}
      />

      <div className="content">
        <DemoNotice snapshot={data.snapshot} demoEntries={data.demoEntries} />

        <h2 className="sectionTitle">
          All metrics · week of {formatWeekRange(data.displayWeek)}
        </h2>
        <section className="card">
          <ComparisonTable rows={rows} />
        </section>

        <h2 className="sectionTitle">Member growth · last {data.weeks.length} weeks</h2>
        <section className="card">
          <div className="card__head">
            <div>
              <div className="card__title">Member count, all five groups</div>
              <div className="card__sub">
                One shared scale. Click a group to bring its line forward.
              </div>
            </div>
          </div>
          <div className="card__body">
            <MultiGroupTrend
              rows={memberRows}
              series={series}
              unit="count"
              height={330}
              metricLabel="Member count"
              initialFocus={biggest?.group ?? null}
            />
          </div>
        </section>
      </div>
    </>
  );
}
