import { PageHeader } from '@/components/PageHeader';
import { StatCard, StatCardPercentDelta } from '@/components/StatCard';
import { CommunityRollupCard } from '@/components/CommunityRollupCard';
import { MultiGroupTrend } from '@/components/charts';
import { DemoNotice } from '@/components/DemoNotice';
import { COMMUNITIES, countNoun } from '@/lib/groups';
import { TrafficFunnel } from '@/components/TrafficFunnel';
import {
  loadDashboard,
  mergedTotals,
  multiCommunityRows,
  perCommunityTotals,
  trafficFunnel,
} from '@/lib/dashboard';
import { formatExact, formatPercent, pct } from '@/lib/metrics';
import { formatWeekRange } from '@/lib/weeks';

export const dynamic = 'force-dynamic';

/**
 * The merged report: both communities rolled up together.
 *
 * Every figure is the pooled value across all groups in both communities. Rates
 * are recomputed from summed numerators and denominators — never the average of
 * two communities' percentages, which would let a 610-member cohort pull the
 * combined rate as hard as a 4,400-member one.
 */
export default async function MergedOverviewPage() {
  const data = await loadDashboard();
  const totals = mergedTotals(data);
  const byCommunity = perCommunityTotals(data);

  /** Pooled growth for a set of groups: added ÷ last week's pooled base. */
  const growthFor = (slugs: string[]): number | null => {
    const metrics = data.perGroup.filter((m) => slugs.includes(m.group));
    const withPrev = metrics.filter((m) => m.entry !== null && m.previousEntry !== null);
    if (withPrev.length === 0) return null;
    const base = withPrev.reduce((s, m) => s + (m.previousEntry?.totalMembers ?? 0), 0);
    const added = withPrev.reduce(
      (s, m) => s + ((m.entry?.totalMembers ?? 0) - (m.previousEntry?.totalMembers ?? 0)),
      0,
    );
    return pct(added, base);
  };

  const allSlugs = data.perGroup.map((m) => m.group);
  const mergedGrowth = growthFor(allSlugs);

  const communitySeries = COMMUNITIES.map((c) => ({ key: c.slug, label: c.label }));
  const memberRows = multiCommunityRows(data, 'totalMembers');
  const biggest = [...byCommunity].sort((a, b) => b.totals.members - a.totals.members)[0];

  return (
    <>
      <PageHeader
        eyebrow="Merged · All communities"
        title="Combined report"
        weekStart={data.displayWeek}
        states={data.snapshot.states}
        fetchedAt={data.snapshot.fetchedAt}
      />

      <div className="content">
        <DemoNotice snapshot={data.snapshot} demoEntries={data.demoEntries} />

        <div className="grid grid--stats">
          <StatCard
            label="Total members"
            value={formatExact(totals.members)}
            delta={totals.newMembers}
            deltaSuffix={
              mergedGrowth !== null
                ? `new · ${formatPercent(mergedGrowth)} growth`
                : 'new this week'
            }
            accent
          />
          {totals.leads !== null ? (
            <StatCard
              label="Leads this week"
              value={formatExact(totals.leads)}
              hint={
                totals.sessions !== null
                  ? `${formatPercent(totals.leadConversionPct)} of ${formatExact(totals.sessions)} sessions`
                  : 'from the registration sheet'
              }
            />
          ) : null}
          <StatCardPercentDelta
            label="Poll response rate"
            value={formatPercent(totals.pollResponseRatePct)}
            hint="Responses ÷ members, pooled"
          />
          <StatCardPercentDelta
            label="DM reply rate"
            value={formatPercent(totals.dmReplyRatePct)}
            hint="Replies ÷ DMs sent, pooled"
          />
        </div>

        <p className="chartNote" style={{ marginTop: 10 }}>
          Pooled across {countNoun(COMMUNITIES.length, 'communities')} and{' '}
          {countNoun(totals.groupCount, 'groups')}, for the week of{' '}
          {formatWeekRange(data.displayWeek)}. Rates are recomputed from summed numerators and
          denominators, not averaged across communities. Traffic and lead figures cover only
          the communities the automated sources represent.
        </p>

        {/* The combined traffic/funnel layer: every declared source across every
            community, rolled up. Scoped by config, so a future community's
            sources join this automatically. */}
        <h2 className="sectionTitle">Traffic &amp; funnel · automated sources</h2>
        <TrafficFunnel
          totals={trafficFunnel(data)}
          subtitle="Short.io → GA4 → registrations, across every community with declared sources"
        />

        <h2 className="sectionTitle">By community</h2>
        <div className="grid grid--halves">
          {byCommunity.map(({ community, totals: communityTotal }) => {
            const config = COMMUNITIES.find((c) => c.slug === community);
            if (!config) return null;
            return (
              <CommunityRollupCard
                key={community}
                community={config}
                totals={communityTotal}
                growthPct={growthFor(config.groups.map((g) => g.slug))}
              />
            );
          })}
        </div>

        <h2 className="sectionTitle">
          Member growth by community · last {data.weeks.length} weeks
        </h2>
        <section className="card">
          <div className="card__head">
            <div>
              <div className="card__title">Pooled member count per community</div>
              <div className="card__sub">
                One shared scale. Click a community to bring its line forward.
              </div>
            </div>
          </div>
          <div className="card__body">
            <MultiGroupTrend
              rows={memberRows}
              series={communitySeries}
              unit="count"
              height={320}
              metricLabel="Member count"
              initialFocus={biggest?.community ?? null}
            />
          </div>
        </section>
      </div>
    </>
  );
}
