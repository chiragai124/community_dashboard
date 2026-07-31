import { PageHeader } from '@/components/PageHeader';
import { ComparisonTable, type ComparisonRow } from '@/components/ComparisonTable';
import { DemoNotice } from '@/components/DemoNotice';
import { COMMUNITIES, getCommunity, getGroup } from '@/lib/groups';
import { loadDashboard, perCommunityTotals } from '@/lib/dashboard';
import { formatExact, formatPercent, pct } from '@/lib/metrics';
import { formatWeekRange } from '@/lib/weeks';

export const dynamic = 'force-dynamic';

/**
 * Every group from every community in one sortable table, with a community
 * column so the two populations stay distinguishable while being compared.
 */
export default async function MergedComparisonPage() {
  const data = await loadDashboard();

  const rows: ComparisonRow[] = data.perGroup.map((metrics) => {
    const group = getGroup(metrics.group);
    const community = getCommunity(metrics.community);
    return {
      group: metrics.group,
      label: group?.label ?? metrics.group,
      flag: group?.flag ?? '',
      href: `/c/${metrics.community}/group/${metrics.group}`,
      communityLabel: community?.label ?? metrics.community,
      totalMembers: metrics.totalMembers,
      newMembers: metrics.newMembers,
      memberGrowthPct: metrics.memberGrowthPct,
      pollResponses: metrics.pollResponses,
      pollResponseRatePct: metrics.pollResponseRatePct,
      dmsSent: metrics.dmsSent,
      dmReplies: metrics.dmReplies,
      dmReplyRatePct: metrics.dmReplyRatePct,
      // Null leads = the group's community isn't covered by the sources.
      activityLevel: metrics.activityLevel,
      hasEntry: metrics.entry !== null,
    };
  });

  const byCommunity = perCommunityTotals(data);

  return (
    <>
      <PageHeader
        eyebrow="Merged · All communities"
        title="All groups"
        weekStart={data.displayWeek}
      />

      <div className="content">
        <DemoNotice demoEntries={data.demoEntries} />

        <h2 className="sectionTitle">
          Every group and segment · week of {formatWeekRange(data.displayWeek)}
        </h2>
        <section className="card">
          <ComparisonTable rows={rows} />
        </section>

        <h2 className="sectionTitle">Community subtotals</h2>
        <section className="card">
          <div className="tableWrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Community</th>
                  <th className="num">Members</th>
                  <th className="num">New</th>
                  <th className="num">Poll rate</th>
                  <th className="num">DM reply</th>
                  <th className="num">Leads</th>
                  <th className="num">Sessions</th>
                  <th className="num">Groups</th>
                </tr>
              </thead>
              <tbody>
                {byCommunity.map(({ community, totals }) => {
                  const config = COMMUNITIES.find((c) => c.slug === community);
                  return (
                    <tr key={community}>
                      <td className="name">{config?.label ?? community}</td>
                      <td className="num">{formatExact(totals.members)}</td>
                      <td className="num">{formatExact(totals.newMembers)}</td>
                      <td className="num">{formatPercent(totals.pollResponseRatePct)}</td>
                      <td className="num">{formatPercent(totals.dmReplyRatePct)}</td>
                      <td className="num">{totals.groupCount}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="tableFoot">
            Subtotal rates are pooled within each community, so they are not the average of
            its groups’ rates.
          </div>
        </section>
      </div>
    </>
  );
}
