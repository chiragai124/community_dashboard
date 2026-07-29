import { PageHeader } from '@/components/PageHeader';
import { GroupCard } from '@/components/GroupCard';
import { StatCard, StatCardPercentDelta } from '@/components/StatCard';
import { DemoNotice } from '@/components/DemoNotice';
import { loadDashboard, overviewTotals } from '@/lib/dashboard';
import { formatExact, formatPercent, formatSigned } from '@/lib/metrics';
import { getGroup } from '@/lib/groups';
import { formatWeekRange } from '@/lib/weeks';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  const data = await loadDashboard();
  const totals = overviewTotals(data.perGroup);

  const notes = data.perGroup.filter((m) => m.notes.trim() !== '');
  const missing = data.perGroup.filter((m) => m.entry === null);

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="All five communities"
        weekStart={data.displayWeek}
        states={data.snapshot.states}
        fetchedAt={data.snapshot.fetchedAt}
      />

      <div className="content">
        <DemoNotice snapshot={data.snapshot} demoEntries={data.demoEntries} />

        <div className="grid grid--stats">
          <StatCard
            label="Members, all groups"
            value={formatExact(totals.members)}
            delta={totals.newMembers}
            deltaSuffix="new this week"
            accent
          />
          <StatCard
            label="Leads this week"
            value={formatExact(totals.leads)}
            hint={`${formatPercent(totals.leadConversionPct)} of ${formatExact(totals.sessions)} sessions`}
          />
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

        <h2 className="sectionTitle">
          Groups · week of {formatWeekRange(data.displayWeek)}
        </h2>
        <div className="grid grid--groups">
          {data.perGroup.map((metrics) => (
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
                <div className="emptyState">
                  No notes logged for this week yet.
                </div>
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
                  {totals.groupsWithEntry} of {data.perGroup.length} groups logged for this week
                </div>
              </div>
            </div>
            <div className="card__body">
              {missing.length === 0 ? (
                <div className="emptyState">
                  All five groups are logged for {formatWeekRange(data.displayWeek)}.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {missing.map((metrics) => {
                    const group = getGroup(metrics.group);
                    return (
                      <a
                        key={metrics.group}
                        href={`/group/${metrics.group}`}
                        className="prefillNote"
                        style={{ display: 'block' }}
                      >
                        <strong>
                          {group?.flag} {group?.label}
                        </strong>{' '}
                        has no entry for this week — add it →
                      </a>
                    );
                  })}
                </div>
              )}
              <p className="chartNote">
                Manual entry takes about a minute per group: member count, polls, DMs, activity.
              </p>
            </div>
          </section>
        </div>

        <h2 className="sectionTitle">Fastest movers this week</h2>
        <div className="grid grid--stats">
          {[...data.perGroup]
            .filter((m) => m.memberGrowthPct !== null)
            .sort((a, b) => (b.memberGrowthPct ?? 0) - (a.memberGrowthPct ?? 0))
            .slice(0, 3)
            .map((metrics, index) => {
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
      </div>
    </>
  );
}
