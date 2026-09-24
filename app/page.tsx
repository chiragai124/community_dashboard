import { PageHeader } from '@/components/PageHeader';
import { RegenerateButton } from '@/components/RegenerateButton';
import { ReportPeriodPicker } from '@/components/ReportPeriodPicker';
import { InstagramEntryForm } from '@/components/InstagramEntryForm';
import { LandingWadlDashboard } from '@/components/LandingWadlDashboard';
import {
  InstagramSection,
  LeadsFunnel,
  MemberCountTable,
} from '@/components/ReportSections';
import { COMMUNITIES } from '@/lib/groups';
import {
  communityLeads,
  communityMembers,
  headlineTakeaways,
  instagramMembers,
  instagramMembersEntered,
  loadDashboard,
  perCommunityTotals,
  previousCommunityLeads,
  previousCommunityMembers,
  previousGa4,
  previousInstagramMembers,
  previousShortio,
  reportWindow,
  shortioReportSeries,
  GA4_FIGURES,
} from '@/lib/dashboard';
import { formatExact } from '@/lib/metrics';
import { formatDateRange } from '@/lib/period';
import { groqEnabled } from '@/lib/ai/groq';
import { getOverviewTakeaways } from '@/lib/ai/store';
import type { TrendRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * The Overview tab: the weekly report's front page, in the order the report
 * itself reads — member count, Instagram broadcast channel, accommodation
 * poll and follow-up funnel, messages by community, landing page & WADL, and
 * the headline takeaways.
 *
 * Every figure on this page answers for one date range, shown and chosen at
 * the top. Past reports are browsable from the same control; opening one
 * shows what that report said, not today's numbers under yesterday's dates.
 */
export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period: periodParam } = await searchParams;
  const data = await loadDashboard(periodParam);

  // Sorted by volume, loudest first, to match the weekly report: the ranking
  // is the point of this chart, and registry order buried it.
  const byCommunity = [...perCommunityTotals(data)].sort(
    (a, b) => b.totals.messageCount - a.totals.messageCount,
  );
  const stored = await getOverviewTakeaways();
  const takeaways = stored?.takeaways ?? headlineTakeaways(data);
  const aiAvailable = groqEnabled();

  const previousLabel = data.previous
    ? formatDateRange(data.previous.periodStart, data.previous.periodEnd)
    : null;

  const memberRows = COMMUNITIES.map((community) => ({
    community,
    current: communityMembers(data, community.slug)?.value ?? null,
    previous: previousCommunityMembers(data, community.slug),
  }));

  const leadRows = COMMUNITIES.map((community) => ({
    community,
    current: communityLeads(data, community.slug),
    previous: previousCommunityLeads(data, community.slug),
  }));

  const maxMessages = Math.max(...byCommunity.map((c) => c.totals.messageCount), 1);
  const busiestCommunity = [...byCommunity].sort(
    (a, b) => b.totals.messageCount - a.totals.messageCount,
  )[0]?.community;

  // One row per filed report, oldest first — the x-axis of the landing-page
  // trend lines. Built once here and passed down, so the chart component
  // stays a pure renderer.
  const window = reportWindow(data, 12);
  const ga4Rows: TrendRow[] = window.map((report) => {
    const row: TrendRow = { week: report.periodEnd };
    for (const figure of GA4_FIGURES) row[figure.key] = figure.pick(report.snapshot.ga4);
    return row;
  });

  const periodOptions = [...data.reports].reverse().map((report) => ({
    id: report.id,
    start: report.periodStart,
    end: report.periodEnd,
    filedLabel: describeReport(report.snapshot.totalMembers, report.snapshot.communities.length),
  }));

  return (
    <>
      <PageHeader
        eyebrow="Overview · All communities"
        title="Weekly Community Report"
        periodLabel={formatDateRange(data.period.start, data.period.end)}
      />

      <div className="content">
        <ReportPeriodPicker
          period={data.period}
          activePeriod={data.activePeriod}
          isActivePeriod={data.isActivePeriod}
          options={periodOptions}
        />

        <h2 className="sectionTitle">Member count</h2>
        <MemberCountTable rows={memberRows} previousLabel={previousLabel} />

        <h2 className="sectionTitle">Instagram broadcast channel</h2>
        <InstagramSection
          members={instagramMembers(data)}
          previousMembers={previousInstagramMembers(data)}
          createdOn={data.instagramChannel.createdOn}
          periodEnd={data.period.end}
          previousLabel={previousLabel}
        />

        {/* The channel is one thing, not one per community, so its entry form
            lives here beside its figures rather than on a community tab. */}
        <InstagramEntryForm
          key={`ig-${data.period.start}-${data.period.end}`}
          currentMembers={instagramMembersEntered(data)}
          createdOn={data.instagramChannel.createdOn}
          period={data.activePeriod}
        />

        <h2 className="sectionTitle">Accommodation poll &amp; follow-up funnel</h2>
        <LeadsFunnel rows={leadRows} previousLabel={previousLabel} />

        <h2 className="sectionTitle">Messages this period, by community</h2>
        <section className="card">
          <div className="card__body">
            <div className="bars">
              {byCommunity.map(({ community, totals }) => {
                const config = COMMUNITIES.find((c) => c.slug === community);
                return (
                  <div className="bar-row" key={community}>
                    <div className="bar-row__top">
                      <span className="bar-row__label">{config?.label ?? community}</span>
                      <span className="bar-row__value">{formatExact(totals.messageCount)}</span>
                    </div>
                    <div
                      className="bar-track"
                      role="img"
                      aria-label={`${config?.label}: ${formatExact(totals.messageCount)} messages`}
                    >
                      <div
                        className={`bar-fill${community === busiestCommunity ? ' bar-fill--lead' : ''}`}
                        style={{ width: `${Math.max((totals.messageCount / maxMessages) * 100, 2)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            {byCommunity.every((c) => c.totals.groupsWithEntry === 0) ? (
              <p className="chartNote">
                No WhatsApp exports filed for this period — upload a community&rsquo;s chat exports
                from its tab to see numbers here.
              </p>
            ) : null}
          </div>
        </section>

        <LandingWadlDashboard
          period={data.period}
          ga4={data.ga4}
          shortio={data.shortio}
          previousGa4={previousGa4(data)}
          previousShortio={previousShortio(data)}
          ga4Rows={ga4Rows}
          shortioPoints={shortioReportSeries(data, (s) => s?.totalClicks ?? null, 12)}
          previousLabel={previousLabel}
        />

        <h2 className="sectionTitle">Headline takeaways</h2>
        {takeaways.length > 0 ? (
          <div className="calloutGrid">
            {takeaways.map((t, i) => (
              <div
                className={`callout${t.tone === 'good' ? ' callout--good' : t.tone === 'urgent' ? ' callout--urgent' : ''}`}
                key={`${t.tag}-${i}`}
              >
                <span className="callout__tag">{t.tag}</span>
                <p className="callout__text" style={{ margin: 0 }}>
                  {t.text}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="chartNote">
            Nothing to report yet — upload a WhatsApp export somewhere first.
          </p>
        )}
        {aiAvailable ? (
          <div style={{ marginTop: 12 }}>
            <RegenerateButton
              endpoint="/api/ai/overview-takeaways"
              label={stored ? 'Regenerate with AI' : 'Generate richer takeaways with AI'}
            />
            {stored ? (
              <p className="aiNote">
                Showing AI-generated takeaways. Falls back to local heuristics if regeneration
                fails.
              </p>
            ) : (
              <p className="aiNote">
                Showing local heuristics — generate a richer, narrative version above.
              </p>
            )}
          </div>
        ) : null}
      </div>
    </>
  );
}

/** A one-glance summary of a filed report, for the period dropdown. */
function describeReport(totalMembers: number | null, communityCount: number): string {
  if (totalMembers === null) return `${communityCount} communities, no member total`;
  return `${totalMembers.toLocaleString('en-US')} members`;
}
