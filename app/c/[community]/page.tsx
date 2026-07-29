import { notFound } from 'next/navigation';
import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader';
import { GroupCard } from '@/components/GroupCard';
import { StatCard, StatCardPercentDelta } from '@/components/StatCard';
import { DemoNotice } from '@/components/DemoNotice';
import { communityTotals, groupsInCommunity, loadDashboard, trafficFunnel } from '@/lib/dashboard';
import { countNoun, getCommunity, getGroup, integrationsFor } from '@/lib/groups';
import { TrafficFunnel } from '@/components/TrafficFunnel';
import { formatExact, formatPercent, formatSigned } from '@/lib/metrics';
import { formatWeekRange } from '@/lib/weeks';

export const dynamic = 'force-dynamic';

/**
 * One community's overview: its groups side by side, its pooled totals, its
 * notes and which of its groups still need an entry. Generic across
 * communities — a community with one segment renders the same way as one with
 * five.
 */
export default async function CommunityOverviewPage({
  params,
}: {
  params: Promise<{ community: string }>;
}) {
  const { community: communitySlug } = await params;
  const community = getCommunity(communitySlug);
  if (!community) notFound();

  const data = await loadDashboard();
  const perGroup = groupsInCommunity(data, community.slug);
  const totals = communityTotals(data, community.slug);

  const notes = perGroup.filter((m) => m.notes.trim() !== '');
  const missing = perGroup.filter((m) => m.entry === null);
  const movers = [...perGroup]
    .filter((m) => m.memberGrowthPct !== null)
    .sort((a, b) => (b.memberGrowthPct ?? 0) - (a.memberGrowthPct ?? 0))
    .slice(0, 3);

  const noun = community.groupNoun.toLowerCase();
  // Whether any automated source represents this community. Manual-only
  // communities show no pulled figures, no source pills, no refresh button.
  const hasSources = integrationsFor(community.slug).length > 0;
  const funnel = hasSources ? trafficFunnel(data, community.slug) : null;

  return (
    <>
      <PageHeader
        eyebrow={`${community.label} · Overview`}
        title={community.name}
        weekStart={data.displayWeek}
        states={hasSources ? data.snapshot.states : []}
        fetchedAt={data.snapshot.fetchedAt}
      />

      <div className="content">
        <DemoNotice
          snapshot={data.snapshot}
          demoEntries={data.demoEntries}
          sources={hasSources}
        />

        <div className="grid grid--stats">
          <StatCard
            label={totals.groupCount === 1 ? 'Members' : `Members, all ${noun}`}
            value={formatExact(totals.members)}
            delta={totals.newMembers}
            deltaSuffix="new this week"
            accent
          />
          {/* Only communities with Sheets coverage have a lead count at all. */}
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

        {funnel ? (
          <div style={{ marginTop: 14 }}>
            <TrafficFunnel
              totals={funnel}
              subtitle={`Short.io → GA4 → registrations, attributed to ${community.label}`}
            />
          </div>
        ) : null}

        <h2 className="sectionTitle">
          {community.groupNoun} · week of {formatWeekRange(data.displayWeek)}
        </h2>
        <div className={`grid ${perGroup.length > 2 ? 'grid--groups' : 'grid--halves'}`}>
          {perGroup.map((metrics) => (
            <GroupCard key={metrics.group} metrics={metrics} />
          ))}
        </div>

        <div className="grid grid--halves" style={{ marginTop: 22 }}>
          <section className="card">
            <div className="card__head">
              <div>
                <div className="card__title">This week’s notes</div>
                <div className="card__sub">Straight from the manual weekly entries</div>
              </div>
            </div>
            <div className="card__body">
              {notes.length === 0 ? (
                <div className="emptyState">No notes logged for this week yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
                  {notes.map((metrics) => {
                    const group = getGroup(metrics.group);
                    return (
                      <div key={metrics.group}>
                        <div
                          style={{
                            fontSize: 12.5,
                            fontWeight: 600,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          <span aria-hidden="true">{group?.flag}</span>
                          {group?.label}
                        </div>
                        <p style={{ margin: '3px 0 0', fontSize: 13, color: 'var(--ink-secondary)' }}>
                          {metrics.notes}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          <section className="card">
            <div className="card__head">
              <div>
                <div className="card__title">Weekly entry status</div>
                <div className="card__sub">
                  {totals.groupsWithEntry} of {countNoun(totals.groupCount, noun)} logged for
                  this week
                </div>
              </div>
            </div>
            <div className="card__body">
              {missing.length === 0 ? (
                <div className="emptyState">
                  {totals.groupCount === 1 ? 'Logged' : `All ${noun} are logged`} for{' '}
                  {formatWeekRange(data.displayWeek)}.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {missing.map((metrics) => {
                    const group = getGroup(metrics.group);
                    return (
                      <Link
                        key={metrics.group}
                        href={`/c/${community.slug}/group/${metrics.group}`}
                        className="prefillNote"
                        style={{ display: 'block' }}
                      >
                        <strong>
                          {group?.flag} {group?.label}
                        </strong>{' '}
                        has no entry for this week — add it →
                      </Link>
                    );
                  })}
                </div>
              )}
              <p className="chartNote">
                Manual entry takes about a minute each: member count, polls, DMs, activity.
              </p>
            </div>
          </section>
        </div>

        {/* Needs at least two weeks of entries to rank anything — hidden rather
            than left as a heading over an empty row. Also pointless for a
            single-group community, where there is nothing to rank against. */}
        {movers.length > 1 ? (
          <>
            <h2 className="sectionTitle">Fastest movers this week</h2>
            <div className="grid grid--stats">
              {movers.map((metrics, index) => {
                const group = getGroup(metrics.group);
                return (
                  <StatCardPercentDelta
                    key={metrics.group}
                    label={`${index + 1}. ${group?.label ?? metrics.group} member growth`}
                    value={formatPercent(metrics.memberGrowthPct)}
                    hint={`${formatSigned(metrics.newMembers)} new members`}
                    accent={index === 0}
                  />
                );
              })}
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}
