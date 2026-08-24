import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { StatCard } from '@/components/StatCard';
import { SnapshotCard } from '@/components/SnapshotCard';
import { MemberComparison } from '@/components/MemberComparison';
import { CommunityMemberEntryForm } from '@/components/CommunityMemberEntryForm';
import { CommunityTopicsPanel } from '@/components/CommunityTopicsPanel';
import {
  activityExtremes,
  communityMembers,
  communityTotals,
  groupsInCommunity,
  loadDashboard,
  previousCommunityMembers,
} from '@/lib/dashboard';
import { getCommunity, getGroup } from '@/lib/groups';
import { formatExact } from '@/lib/metrics';
import { formatDateRange } from '@/lib/period';
import { groqEnabled } from '@/lib/ai/groq';
import { getCommunitySummaries } from '@/lib/ai/store';

export const dynamic = 'force-dynamic';

/**
 * One community's tab: headline figures, a messages-by-group bar chart, a
 * manual member-total entry, a member-vs-previous-report comparison, a
 * snapshot card per group, and a community-wide topics/narrative synthesis.
 * Group detail (full sentiment, WhatsApp upload) is one click away via each
 * card's link — this page itself stays a single-screen report, matching the
 * reference.
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

  const memberEntry = communityMembers(data, community.slug);
  const previousMemberEntry = previousCommunityMembers(data, community.slug);

  const periodLabel = range
    ? `${formatDateRange(range.start, range.end)}${memberEntry ? ` · ${formatExact(memberEntry.total)} members` : ''}`
    : memberEntry
      ? `${formatExact(memberEntry.total)} members`
      : null;

  const summaries = await getCommunitySummaries();

  return (
    <>
      <PageHeader eyebrow={`${community.label} · Weekly report`} title={community.name} periodLabel={periodLabel} />

      <div className="content">
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

        <h2 className="sectionTitle">Total members</h2>
        <CommunityMemberEntryForm community={community.slug} currentTotal={memberEntry?.total ?? null} />

        <h2 className="sectionTitle">Members vs. previous report</h2>
        <MemberComparison
          currentMembers={memberEntry?.total ?? 0}
          previousMembers={previousMemberEntry?.total ?? null}
          previousLabel={previousMemberEntry ? previousMemberEntry.enteredAt : null}
        />

        <h2 className="sectionTitle">Messages by Group</h2>
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

        <h2 className="sectionTitle">Group Snapshots</h2>
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
