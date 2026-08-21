import { PageHeader } from '@/components/PageHeader';
import { StatCard } from '@/components/StatCard';
import { MemberComparison } from '@/components/MemberComparison';
import { RegenerateButton } from '@/components/RegenerateButton';
import { COMMUNITIES } from '@/lib/groups';
import {
  allCommunitiesTotals,
  headlineTakeaways,
  loadDashboard,
  overallPeriodRange,
  perCommunityTotals,
} from '@/lib/dashboard';
import { formatExact, formatSigned } from '@/lib/metrics';
import { formatDateRange } from '@/lib/period';
import { groqEnabled } from '@/lib/ai/groq';
import { getOverviewTakeaways } from '@/lib/ai/store';

export const dynamic = 'force-dynamic';

/**
 * The Overview tab: total membership across every community, a member and
 * message count per community, two bar charts, a member-vs-previous-report
 * comparison, and a handful of headline takeaways — the front page of the
 * weekly report.
 */
export default async function OverviewPage() {
  const data = await loadDashboard();
  const totals = allCommunitiesTotals(data);
  const byCommunity = perCommunityTotals(data);
  const range = overallPeriodRange(data);
  const stored = await getOverviewTakeaways();
  const takeaways = stored?.takeaways ?? headlineTakeaways(data);
  const aiAvailable = groqEnabled();

  const maxMembers = Math.max(...byCommunity.map((c) => c.totals.members), 1);
  const maxMessages = Math.max(...byCommunity.map((c) => c.totals.messageCount), 1);
  const busiestCommunity = [...byCommunity].sort(
    (a, b) => b.totals.messageCount - a.totals.messageCount,
  )[0]?.community;

  return (
    <>
      <PageHeader
        eyebrow="Overview · All communities"
        title="Weekly Engagement Report"
        periodLabel={range ? formatDateRange(range.start, range.end) : null}
      />

      <div className="content">
        <div className="heroBlock">
          <span className="heroBlock__label">Total members, all communities</span>
          <span className="hero">{formatExact(totals.members)}</span>
          <span className="heroBlock__sub">
            {formatSigned(totals.newMembers)} new since each group's previous report
          </span>
        </div>

        <div className="grid grid--stats">
          {byCommunity.map(({ community, totals: t }) => {
            const config = COMMUNITIES.find((c) => c.slug === community);
            return (
              <StatCard
                key={community}
                label={config?.label ?? community}
                value={formatExact(t.members)}
                delta={t.newMembers}
                deltaSuffix="vs previous report"
              />
            );
          })}
        </div>

        <h2 className="sectionTitle">Members vs. previous report</h2>
        <MemberComparison
          currentMembers={totals.members}
          previousMembers={totals.groupsWithEntry > 0 ? totals.previousMembers : null}
          previousLabel={null}
        />

        <h2 className="sectionTitle">Total membership, by community</h2>
        <section className="card">
          <div className="card__body">
            <div className="bars">
              {byCommunity.map(({ community, totals: t }) => {
                const config = COMMUNITIES.find((c) => c.slug === community);
                return (
                  <div className="bar-row" key={community}>
                    <div className="bar-row__top">
                      <span className="bar-row__label">{config?.label ?? community}</span>
                      <span className="bar-row__value">{formatExact(t.members)}</span>
                    </div>
                    <div
                      className="bar-track"
                      role="img"
                      aria-label={`${config?.label}: ${formatExact(t.members)} members`}
                    >
                      <div
                        className={`bar-fill${community === busiestCommunity ? ' bar-fill--lead' : ''}`}
                        style={{ width: `${Math.max((t.members / maxMembers) * 100, 2)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <h2 className="sectionTitle">Messages this period, by community</h2>
        <section className="card">
          <div className="card__body">
            <div className="bars">
              {byCommunity.map(({ community, totals: t }) => {
                const config = COMMUNITIES.find((c) => c.slug === community);
                return (
                  <div className="bar-row" key={community}>
                    <div className="bar-row__top">
                      <span className="bar-row__label">{config?.label ?? community}</span>
                      <span className="bar-row__value">{formatExact(t.messageCount)}</span>
                    </div>
                    <div
                      className="bar-track"
                      role="img"
                      aria-label={`${config?.label}: ${formatExact(t.messageCount)} messages`}
                    >
                      <div
                        className={`bar-fill${community === busiestCommunity ? ' bar-fill--lead' : ''}`}
                        style={{ width: `${Math.max((t.messageCount / maxMessages) * 100, 2)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            {totals.groupsWithEntry === 0 ? (
              <p className="chartNote">
                No WhatsApp imports yet — upload a group's chat export from its Community tab to
                see numbers here.
              </p>
            ) : null}
          </div>
        </section>

        <h2 className="sectionTitle">Headline takeaways</h2>
        {takeaways.length > 0 ? (
          <div className="calloutGrid">
            {takeaways.map((t, i) => (
              <div className={`callout${t.tone === 'good' ? ' callout--good' : ''}`} key={`${t.tag}-${i}`}>
                <span className="callout__tag">{t.tag}</span>
                <p className="callout__text" style={{ margin: 0 }}>
                  {t.text}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="chartNote">Nothing to report yet — upload a WhatsApp export somewhere first.</p>
        )}
        {aiAvailable ? (
          <div style={{ marginTop: 12 }}>
            <RegenerateButton
              endpoint="/api/ai/overview-takeaways"
              label={stored ? 'Regenerate with AI' : 'Generate richer takeaways with AI'}
            />
            {stored ? (
              <p className="aiNote">
                Showing AI-generated takeaways. Falls back to local heuristics if regeneration fails.
              </p>
            ) : (
              <p className="aiNote">Showing local heuristics — generate a richer, narrative version above.</p>
            )}
          </div>
        ) : null}
      </div>
    </>
  );
}
