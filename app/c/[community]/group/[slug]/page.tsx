import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { StatCard, StatCardPercentDelta, ActivityBadge } from '@/components/StatCard';
import { PollHistoryTable } from '@/components/PollHistoryTable';
import { WeeklyEntryForm } from '@/components/WeeklyEntryForm';
import { SingleTrendChart, Sparkline } from '@/components/charts';
import { DemoNotice } from '@/components/DemoNotice';
import { WeekQualitative, hasQualitative } from '@/components/WeekQualitative';
import { getCommunity, getGroup } from '@/lib/groups';
import { entryWeekOptions, groupSeries, loadDashboard } from '@/lib/dashboard';
import { buildPollHistory, formatExact, formatPercent } from '@/lib/metrics';
import { formatWeekRange } from '@/lib/weeks';

// Every figure here is read at request time — nothing is prerendered.
export const dynamic = 'force-dynamic';

export default async function GroupPage({
  params,
}: {
  params: Promise<{ community: string; slug: string }>;
}) {
  const { community: communitySlug, slug } = await params;
  const community = getCommunity(communitySlug);
  const group = getGroup(slug);
  // The group must exist AND belong to the community in the URL, so a mismatched
  // pair 404s rather than rendering a group under the wrong community's header.
  if (!community || !group || group.community !== community.slug) notFound();

  const data = await loadDashboard();
  const metrics = data.perGroup.find((m) => m.group === group.slug);
  if (!metrics) notFound();

  const series = groupSeries(data, group.slug);
  const pollHistory = buildPollHistory(data.entries, group.slug);
  const groupEntries = data.entries.filter((e) => e.group === group.slug);
  const hasEarlierEntry = groupEntries.some((e) => e.weekStart < data.displayWeek);

  const memberPoints = series.map((m) => ({ week: m.weekStart, value: m.totalMembers }));
  const newMemberPoints = series.map((m) => ({ week: m.weekStart, value: m.newMembers }));
  const pollRatePoints = series.map((m) => ({ week: m.weekStart, value: m.pollResponseRatePct }));
  const dmRatePoints = series.map((m) => ({ week: m.weekStart, value: m.dmReplyRatePct }));

  return (
    <>
      <PageHeader
        eyebrow={`${community.label} · ${group.name === group.label ? community.groupNoun.replace(/s$/, '') : 'Group'}`}
        title={`${group.flag} ${group.label}`}
        titleAccessory={
          <>
            <ActivityBadge level={metrics.activityLevel} />
            {/* The "why" sits directly beside the badge, where the level is read. */}
            {metrics.entry?.activityNote.trim() ? (
              <span className="activityWhy" title={metrics.entry.activityNote}>
                {metrics.entry.activityNote}
              </span>
            ) : null}
          </>
        }
        weekStart={data.displayWeek}
      />

      <div className="content">
        <DemoNotice demoEntries={data.demoEntries} />

        {metrics.entry === null ? (
          <div className="prefillNote" style={{ marginBottom: 18 }}>
            No manual entry saved for {formatWeekRange(data.displayWeek)} yet. Member, poll and
            DM figures below stay blank until you add it — the form is at the bottom of this page.
          </div>
        ) : null}

        <div className="grid grid--stats">
          <StatCard
            label="Members"
            value={formatExact(metrics.totalMembers)}
            delta={metrics.newMembers}
            deltaSuffix="vs last week"
            accent
          >
            <Sparkline points={memberPoints} />
          </StatCard>

          <StatCardPercentDelta
            label="Member growth"
            value={formatPercent(metrics.memberGrowthPct)}
            hint={
              metrics.previousEntry
                ? `from ${formatExact(metrics.previousEntry.totalMembers)} last week`
                : 'needs a previous week'
            }
          >
            <Sparkline points={newMemberPoints} />
          </StatCardPercentDelta>

          <StatCardPercentDelta
            label="Poll response rate"
            value={formatPercent(metrics.pollResponseRatePct)}
            hint={`${formatExact(metrics.pollResponses)} responses · ${metrics.pollCount} poll${metrics.pollCount === 1 ? '' : 's'}`}
          >
            <Sparkline points={pollRatePoints} />
          </StatCardPercentDelta>

          <StatCardPercentDelta
            label="DM reply rate"
            value={formatPercent(metrics.dmReplyRatePct)}
            hint={`${formatExact(metrics.dmReplies)} replies from ${formatExact(metrics.dmsSent)} DMs`}
          >
            <Sparkline points={dmRatePoints} />
          </StatCardPercentDelta>

        </div>

        {metrics.notes.trim() !== '' || hasQualitative(metrics.entry) ? (
          <section className="card" style={{ marginTop: 14 }}>
            <div className="card__head">
              <div className="card__title">
                This week’s notes · {formatWeekRange(data.displayWeek)}
              </div>
            </div>
            <div className="card__body">
              {metrics.notes.trim() !== '' ? (
                <p
                  style={{
                    margin: hasQualitative(metrics.entry) ? '0 0 12px' : 0,
                    fontSize: 13.5,
                    color: 'var(--ink-secondary)',
                  }}
                >
                  {metrics.notes}
                </p>
              ) : null}
              {/* Same collapsed-by-default section as the card, so the two views
                  never drift apart. */}
              <WeekQualitative
                entry={metrics.entry}
                variant="panel"
                label="Topics, questions & content response"
              />
            </div>
          </section>
        ) : null}

        <div className="grid grid--halves" style={{ marginTop: 14 }}>
          <section className="card">
            <div className="card__head">
              <div>
                <div className="card__title">Members · last {memberPoints.length} weeks</div>
                <div className="card__sub">End-of-week member count</div>
              </div>
            </div>
            <div className="card__body">
              <SingleTrendChart
                points={memberPoints}
                seriesLabel="Members"
                unit="count"
                height={216}
              />
            </div>
          </section>

          <section className="card">
            <div className="card__head">
              <div>
                <div className="card__title">
                  Poll response rate · last {pollRatePoints.length} weeks
                </div>
                <div className="card__sub">Responses ÷ member count</div>
              </div>
            </div>
            <div className="card__body">
              <SingleTrendChart
                points={pollRatePoints}
                seriesLabel="Poll response rate"
                unit="percent"
                height={216}
              />
            </div>
          </section>
        </div>

        <h2 className="sectionTitle">Poll history</h2>
        <section className="card">
          <PollHistoryTable rows={pollHistory} />
        </section>

        <h2 className="sectionTitle">Weekly entry</h2>
        <section className="card">
          <div className="card__head">
            <div>
              <div className="card__title">Add or edit {group.label}’s week</div>
              <div className="card__sub">
                {hasEarlierEntry
                  ? 'Pre-filled from last week — edit the member count and the delta is worked out for you'
                  : 'First entry for this group — later weeks pre-fill from it automatically'}
              </div>
            </div>
          </div>
          <div className="card__body">
            <WeeklyEntryForm
              group={group.slug}
              groupLabel={group.label}
              weekOptions={entryWeekOptions()}
              entries={groupEntries}
              defaultWeek={data.displayWeek}
            />
          </div>
        </section>
      </div>
    </>
  );
}
