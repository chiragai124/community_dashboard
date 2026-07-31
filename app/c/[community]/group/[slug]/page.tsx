import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { StatCard, StatCardPercentDelta, ActivityBadge } from '@/components/StatCard';
import { PollHistoryTable } from '@/components/PollHistoryTable';
import { WeeklyEntryForm } from '@/components/WeeklyEntryForm';
import { SingleTrendChart, Sparkline } from '@/components/charts';
import { CommonQuestions, GroupTopics } from '@/components/ChatInsights';
import { SentimentPanel, hasSentiment } from '@/components/SentimentPanel';
import { MemberSourceSplit } from '@/components/MemberSourceSplit';
import { getCommunity, getGroup } from '@/lib/groups';
import { entryWeekOptions, groupSeries, loadDashboard } from '@/lib/dashboard';
import { buildPollHistory, formatExact, formatPercent } from '@/lib/metrics';
import { chatImportFor } from '@/lib/whatsapp/store';
import { formatWeekRange } from '@/lib/weeks';

// Every figure here is read at request time — nothing is prerendered.
export const dynamic = 'force-dynamic';

/**
 * One group's week.
 *
 * Almost everything here is computed from that group's chat export. The only
 * typed figures are poll responses and DM counts, and both are labelled as such
 * on the tile — so a reader always knows which numbers came from a file.
 */
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
  const pollHistory = buildPollHistory(data.entries, group.slug, data.chatImports);
  const groupEntries = data.entries.filter((e) => e.group === group.slug);
  const chatRecord = chatImportFor(data.chatImports, group.slug);

  const memberPoints = series.map((m) => ({ week: m.weekStart, value: m.totalMembers }));
  const newMemberPoints = series.map((m) => ({ week: m.weekStart, value: m.newMembers }));
  const messagePoints = series.map((m) => ({ week: m.weekStart, value: m.messages }));
  const activePoints = series.map((m) => ({ week: m.weekStart, value: m.activeParticipants }));
  const pollRatePoints = series.map((m) => ({ week: m.weekStart, value: m.pollResponseRatePct }));
  const dmRatePoints = series.map((m) => ({ week: m.weekStart, value: m.dmReplyRatePct }));

  // The form shows the poll response rate live, so it needs the export's member
  // count per week. Read-only — members are never editable.
  const membersByWeek: Record<string, number | null> = {};
  for (const week of entryWeekOptions()) {
    membersByWeek[week] = chatRecord?.weeks.find((w) => w.weekStart === week)?.members ?? null;
  }

  return (
    <>
      <PageHeader
        eyebrow={`${community.label} · ${group.name === group.label ? community.groupNoun.replace(/s$/, '') : 'Group'}`}
        title={`${group.flag} ${group.label}`}
        titleAccessory={
          <>
            <ActivityBadge level={metrics.activityLevel} />
            {/* Activity is now a measurement, not a note: it comes from this
                week's message volume against the group's own median week. */}
            {metrics.messages !== null ? (
              <span className="activityWhy">
                {formatExact(metrics.messages)} messages ·{' '}
                {formatExact(metrics.activeParticipants)} posting
              </span>
            ) : null}
          </>
        }
        weekStart={data.displayWeek}
      />

      <div className="content">
        {chatRecord === null ? (
          <div className="prefillNote" style={{ marginBottom: 18 }}>
            No chat export imported for {group.label} yet. Members, growth, activity, topics,
            questions and sentiment all come from that file — import it from the{' '}
            {community.label} overview.
          </div>
        ) : metrics.chat === null ? (
          <div className="prefillNote" style={{ marginBottom: 18 }}>
            The export on file for {group.label} doesn’t cover{' '}
            {formatWeekRange(data.displayWeek)}. Re-export the chat to bring it up to date.
          </div>
        ) : !chatRecord.membersKnown ? (
          <div className="prefillNote" style={{ marginBottom: 18 }}>
            This export doesn’t reach the group’s creation, so there is no baseline for an
            absolute member count — net change per week is shown instead. Export the full
            history to get absolute figures.
          </div>
        ) : null}

        <div className="grid grid--stats">
          <StatCard
            label="Members"
            value={formatExact(metrics.totalMembers)}
            delta={metrics.newMembers}
            deltaSuffix="net this week"
            accent
          >
            <Sparkline points={memberPoints} />
          </StatCard>

          <StatCardPercentDelta
            label="Member growth"
            value={formatPercent(metrics.memberGrowthPct)}
            hint="week over week, from the export"
          >
            <Sparkline points={newMemberPoints} />
          </StatCardPercentDelta>

          <StatCard
            label="Messages"
            value={formatExact(metrics.messages)}
            hint={`${formatExact(metrics.activeParticipants)} people posted`}
          >
            <Sparkline points={messagePoints} />
          </StatCard>

          <StatCardPercentDelta
            label="Poll response rate"
            value={formatPercent(metrics.pollResponseRatePct)}
            hint={`${formatExact(metrics.pollResponses)} responses · ${metrics.pollCount} poll${metrics.pollCount === 1 ? '' : 's'} · typed`}
          >
            <Sparkline points={pollRatePoints} />
          </StatCardPercentDelta>

          <StatCardPercentDelta
            label="DM reply rate"
            value={formatPercent(metrics.dmReplyRatePct)}
            hint={`${formatExact(metrics.dmReplies)} replies from ${formatExact(metrics.dmsSent)} DMs · typed`}
          >
            <Sparkline points={dmRatePoints} />
          </StatCardPercentDelta>
        </div>

        {metrics.topics.length > 0 ? (
          <section className="card" style={{ marginTop: 14 }}>
            <div className="card__head">
              <div>
                <div className="card__title">Topics · {formatWeekRange(data.displayWeek)}</div>
                <div className="card__sub">
                  The words and phrases that recurred most, with the number of messages using each
                </div>
              </div>
            </div>
            <div className="card__body">
              <div className="tagRow">
                {metrics.topics.slice(0, 12).map((topic) => (
                  <span className="tag" key={topic.term}>
                    {topic.term}
                    <span className="tag__count"> {topic.messages}</span>
                  </span>
                ))}
              </div>
              <p className="chartNote">
                Counted per message, so one person repeating a word can’t define the week.
                This is frequency, not a summary of what was meant.
              </p>
            </div>
          </section>
        ) : null}

        {hasSentiment(metrics.sentiment) ? (
          <div style={{ marginTop: 14 }}>
            <SentimentPanel
              sentiment={metrics.sentiment}
              subtitle={
                metrics.sentimentScored > 0
                  ? `${group.label} · keyword-based · ${Math.round(
                      (metrics.sentimentWithSignal / metrics.sentimentScored) * 100,
                    )}% of ${formatExact(metrics.sentimentScored)} messages carried a recognised word`
                  : `${group.label} · ${formatWeekRange(data.displayWeek)}`
              }
            />
          </div>
        ) : null}

        <div style={{ marginTop: 14 }}>
          <MemberSourceSplit
            split={metrics.newMembersBySource}
            newMembers={metrics.newMembers}
            title="How new members arrived"
            subtitle={`${group.label} · ${formatWeekRange(data.displayWeek)} · from the export’s join lines`}
          />
        </div>

        {metrics.questions.length > 0 ? (
          <div style={{ marginTop: 14 }}>
            <CommonQuestions
              questions={metrics.questions}
              subtitle={`${group.label} · ${formatWeekRange(data.displayWeek)}`}
            />
          </div>
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
                  Active members · last {activePoints.length} weeks
                </div>
                <div className="card__sub">People who posted at least once</div>
              </div>
            </div>
            <div className="card__body">
              <SingleTrendChart
                points={activePoints}
                seriesLabel="Active members"
                unit="count"
                height={216}
                wash
              />
            </div>
          </section>
        </div>

        <h2 className="sectionTitle">Poll history</h2>
        <section className="card">
          <PollHistoryTable rows={pollHistory} />
        </section>

        <h2 className="sectionTitle">Polls &amp; DMs</h2>
        <section className="card">
          <div className="card__head">
            <div>
              <div className="card__title">The only figures still typed</div>
              <div className="card__sub">
                Poll votes and 1:1 DMs appear in no export — everything else on this page is
                computed from the chat import
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
              membersByWeek={membersByWeek}
            />
          </div>
        </section>
      </div>
    </>
  );
}
