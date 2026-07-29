import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { StatCard, StatCardPercentDelta, ActivityBadge } from '@/components/StatCard';
import { LeadsBySourceBars } from '@/components/LeadsBySourceBars';
import { PollHistoryTable } from '@/components/PollHistoryTable';
import { WeeklyEntryForm } from '@/components/WeeklyEntryForm';
import { SingleTrendChart, Sparkline } from '@/components/charts';
import { DemoNotice } from '@/components/DemoNotice';
import { getGroup } from '@/lib/groups';
import { entryWeekOptions, groupSeries, loadDashboard, weeklySessions } from '@/lib/dashboard';
import { buildPollHistory, formatExact, formatPercent } from '@/lib/metrics';
import { formatWeekRange } from '@/lib/weeks';

// Every figure here is read at request time — nothing is prerendered.
export const dynamic = 'force-dynamic';

export default async function GroupPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const group = getGroup(slug);
  if (!group) notFound();

  const data = await loadDashboard();
  const metrics = data.perGroup.find((m) => m.group === group.slug);
  if (!metrics) notFound();

  const series = groupSeries(data, group.slug);
  const pollHistory = buildPollHistory(data.entries, group.slug);
  const groupEntries = data.entries.filter((e) => e.group === group.slug);

  const memberPoints = series.map((m) => ({ week: m.weekStart, value: m.totalMembers }));
  const newMemberPoints = series.map((m) => ({ week: m.weekStart, value: m.newMembers }));
  const pollRatePoints = series.map((m) => ({ week: m.weekStart, value: m.pollResponseRatePct }));
  const dmRatePoints = series.map((m) => ({ week: m.weekStart, value: m.dmReplyRatePct }));
  const sessionPoints = weeklySessions(data, group.slug);
  const leadPoints = series.map((m) => ({ week: m.weekStart, value: m.totalLeads }));

  return (
    <>
      <PageHeader
        eyebrow="Group"
        title={`${group.flag} ${group.label}`}
        titleAccessory={<ActivityBadge level={metrics.activityLevel} />}
        weekStart={data.displayWeek}
        states={data.snapshot.states}
        fetchedAt={data.snapshot.fetchedAt}
      />

      <div className="content">
        <DemoNotice snapshot={data.snapshot} demoEntries={data.demoEntries} />

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

          <StatCard
            label="Leads this week"
            value={formatExact(metrics.totalLeads)}
            hint={`${formatExact(metrics.totalSessions)} GA4 sessions`}
          >
            <Sparkline points={leadPoints} />
          </StatCard>
        </div>

        {metrics.notes.trim() !== '' ? (
          <section className="card" style={{ marginTop: 14 }}>
            <div className="card__head">
              <div className="card__title">Notes · {formatWeekRange(data.displayWeek)}</div>
            </div>
            <div className="card__body">
              <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ink-secondary)' }}>
                {metrics.notes}
              </p>
            </div>
          </section>
        ) : null}

        <div className="grid grid--halves" style={{ marginTop: 22 }}>
          <section className="card">
            <div className="card__head">
              <div>
                <div className="card__title">Leads by source · this week</div>
                <div className="card__sub">
                  Registrations from the sheet, bucketed by UTM source
                </div>
              </div>
            </div>
            <div className="card__body">
              <LeadsBySourceBars rows={metrics.leadsBySource} />
              <p className="chartNote">
                Conversion is this week’s leads over the tracked link’s click total from
                Short.io, which reports lifetime clicks — read it as a floor, not an exact
                weekly rate.
              </p>
            </div>
          </section>

          <section className="card">
            <div className="card__head">
              <div>
                <div className="card__title">Site traffic · last {sessionPoints.length} weeks</div>
                <div className="card__sub">
                  GA4 sessions on {group.utmCampaigns[0]}
                </div>
              </div>
            </div>
            <div className="card__body">
              <SingleTrendChart
                points={sessionPoints}
                seriesLabel="Sessions"
                unit="count"
                height={216}
                wash
              />
            </div>
          </section>
        </div>

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
                Pre-filled from last week — edit the member count and the delta is worked out
                for you
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
