import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { StatCard } from '@/components/StatCard';
import { SnapshotCard } from '@/components/SnapshotCard';
import { MemberComparison } from '@/components/MemberComparison';
import { CommunityTopicsPanel } from '@/components/CommunityTopicsPanel';
import { activityExtremes, communityTotals, groupsInCommunity, loadDashboard } from '@/lib/dashboard';
import { getCommunity, getGroup } from '@/lib/groups';
import { formatExact, formatSigned } from '@/lib/metrics';
import { formatDateRange } from '@/lib/period';
import { groqEnabled } from '@/lib/ai/groq';
import { getCommunitySummaries } from '@/lib/ai/store';

export const dynamic = 'force-dynamic';

/**
 * One community's tab: this week's headline figures, a messages-by-group bar
 * chart, a member-vs-previous-report comparison, a snapshot card per group,
 * and a community-wide topics/narrative synthesis. Group detail (full
 * sentiment, WhatsApp upload) is one click away via each card's link — this
 * page itself stays a single-screen report, matching the reference.
 */
export default async function CommunityPage({
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
  const { busiest, quietest } = activityExtremes(perGroup);
  const maxMessages = Math.max(...perGroup.map((m) => m.messageCount ?? 0), 1);

  const busiestGroup = busiest ? getGroup(busiest.group) : null;
  const quietestGroup = quietest ? getGroup(quietest.group) : null;

  const withData = perGroup.filter((m) => m.periodStart && m.periodEnd);
  const range =
    withData.length === 0
      ? null
      : {
          start: withData.reduce((min, m) => (m.periodStart! < min ? m.periodStart! : min), withData[0].periodStart!),
          end: withData.reduce((max, m) => (m.periodEnd! > max ? m.periodEnd! : max), withData[0].periodEnd!),
        };

  const summaries = await getCommunitySummaries();

  return (
    <>
      <PageHeader
        eyebrow={`${community.label} · Weekly report`}
        title={community.name}
        periodLabel={range ? formatDateRange(range.start, range.end) : null}
      />

      <div className="content">
        <div className="heroBlock">
          <span className="heroBlock__label">Total members</span>
          <span className="hero">{formatExact(totals.members)}</span>
          <span className="heroBlock__sub">{formatSigned(totals.newMembers)} vs previous report</span>
        </div>

        <div className="grid grid--stats">
          <StatCard label="Messages this period" value={formatExact(totals.messageCount)} />
          <StatCard label="Unique active chatters" value={formatExact(totals.uniqueActiveChatters)} />
          <StatCard
            label={`Most active group: ${busiestGroup?.label ?? '—'}`}
            value={busiest ? formatExact(busiest.messageCount) : '—'}
          />
          <StatCard
            label={`Quietest group: ${quietestGroup?.label ?? '—'}`}
            value={quietest ? formatExact(quietest.messageCount) : '—'}
          />
        </div>

        <h2 className="sectionTitle">Members vs. previous report</h2>
        <MemberComparison
          currentMembers={totals.members}
          previousMembers={totals.groupsWithEntry > 0 ? totals.previousMembers : null}
          previousLabel={null}
        />

        <h2 className="sectionTitle">Messages by group</h2>
        <section className="card">
          <div className="card__body">
            <div className="bars">
              {perGroup.map((m) => {
                const group = getGroup(m.group);
                const value = m.messageCount ?? 0;
                return (
                  <div className="bar-row" key={m.group}>
                    <div className="bar-row__top">
                      <span className="bar-row__label">
                        <span aria-hidden="true">{group?.flag}</span> {group?.label}
                      </span>
                      <span className="bar-row__value">{formatExact(value)}</span>
                    </div>
                    <div
                      className="bar-track"
                      role="img"
                      aria-label={`${group?.label}: ${formatExact(value)} messages`}
                    >
                      <div
                        className={`bar-fill${m.group === busiest?.group ? ' bar-fill--lead' : ''}`}
                        style={{ width: `${Math.max((value / maxMessages) * 100, 2)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            {totals.groupsWithEntry === 0 ? (
              <p className="chartNote">
                No WhatsApp imports for {community.label} yet — upload a group's chat export from
                its snapshot card below.
              </p>
            ) : null}
          </div>
        </section>

        <h2 className="sectionTitle">Group snapshots</h2>
        <div className="grid grid--snapshots">
          {perGroup.map((metrics) => (
            <SnapshotCard key={metrics.group} metrics={metrics} />
          ))}
        </div>

        <CommunityTopicsPanel
          community={community.slug}
          summary={summaries[community.slug] ?? null}
          groqAvailable={groqEnabled()}
        />
      </div>
    </>
  );
}
