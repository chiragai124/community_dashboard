import { notFound, redirect } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { ComparisonTable, type ComparisonRow } from '@/components/ComparisonTable';
import { MultiGroupTrend } from '@/components/charts';
import { getCommunity, getGroup, singularize } from '@/lib/groups';
import { groupsInCommunity, loadDashboard, multiGroupRows } from '@/lib/dashboard';
import { pct } from '@/lib/metrics';
import { formatWeekRange } from '@/lib/weeks';

export const dynamic = 'force-dynamic';

export default async function CommunityComparisonPage({
  params,
}: {
  params: Promise<{ community: string }>;
}) {
  const { community: communitySlug } = await params;
  const community = getCommunity(communitySlug);
  if (!community) notFound();

  // Nothing to compare in a one-group community — send them to its overview
  // rather than render a single-row table.
  if (community.groups.length < 2) redirect(`/c/${community.slug}`);

  const data = await loadDashboard();
  const perGroup = groupsInCommunity(data, community.slug);
  const noun = community.groupNoun.toLowerCase();
  const singular = singularize(noun);

  const rows: ComparisonRow[] = perGroup.map((metrics) => {
    const group = getGroup(metrics.group);
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
      activityLevel: metrics.activityLevel,
      hasEntry: metrics.entry !== null,
      href: `/c/${community.slug}/group/${metrics.group}`,
    };
  });

  const series = community.groups.map((group) => ({ key: group.slug, label: group.label }));
  const memberRows = multiGroupRows(
    data,
    'totalMembers',
    community.groups.map((g) => g.slug),
  );

  // Open the overlay focused on the largest group, so one line is always
  // legible before the reader clicks anything.
  const biggest = [...perGroup].sort(
    (a, b) => (b.totalMembers ?? 0) - (a.totalMembers ?? 0),
  )[0];

  return (
    <>
      <PageHeader
        eyebrow={`${community.label} · Cross-${singular}`}
        title="Comparison"
        weekStart={data.displayWeek}
      />

      <div className="content">

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
              <div className="card__title">
                Member count, all {community.groups.length} {noun}
              </div>
              <div className="card__sub">
                One shared scale. Click a {singular} to bring its line forward.
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
