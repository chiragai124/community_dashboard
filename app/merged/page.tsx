import { PageHeader } from '@/components/PageHeader';
import { ImportPanel } from '@/components/ImportPanel';
import { LandingWadlDashboard } from '@/components/LandingWadlDashboard';
import { ReportPeriodPicker } from '@/components/ReportPeriodPicker';
import { getCommunity, importsFor, LANDING_PAGE_IMPORTS } from '@/lib/groups';
import { SOURCE_META } from '@/lib/imports';
import {
  GA4_FIGURES,
  loadDashboard,
  previousGa4,
  previousShortio,
  reportWindow,
  shortioReportSeries,
} from '@/lib/dashboard';
import { formatDateRange } from '@/lib/period';
import type { TrendRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Landing page & WADL: the full-width version of the dashboard section that
 * also appears on the Overview, plus the two uploads that feed it.
 *
 * Neither source is WhatsApp community data — GA4 describes the website and
 * Short.io is Community #2's own tracked links — so nothing here is ever
 * pooled with the community reports. It shares the reporting period with
 * them, and nothing else.
 */
export default async function LandingPageAndWadl({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period: periodParam } = await searchParams;
  const data = await loadDashboard(periodParam);

  const community2 = getCommunity('community-2')!;
  const ga4Sources = LANDING_PAGE_IMPORTS.map((source) => SOURCE_META[source]);
  const shortioSources = importsFor('community-2').map((source) => SOURCE_META[source]);

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
    filedLabel: describeSources(report.snapshot.ga4 !== null, report.snapshot.shortio !== null),
  }));

  const previousLabel = data.previous
    ? formatDateRange(data.previous.periodStart, data.previous.periodEnd)
    : null;

  return (
    <>
      <PageHeader
        eyebrow="Landing page & WADL"
        title="Landing page & WADL"
        periodLabel={formatDateRange(data.period.start, data.period.end)}
      />

      <div className="content">
        <ReportPeriodPicker
          period={data.period}
          activePeriod={data.activePeriod}
          isActivePeriod={data.isActivePeriod}
          options={periodOptions}
        />

        <LandingWadlDashboard
          period={data.period}
          ga4={data.ga4}
          shortio={data.shortio}
          previousGa4={previousGa4(data)}
          previousShortio={previousShortio(data)}
          ga4Rows={ga4Rows}
          shortioPoints={shortioReportSeries(data, (s) => s?.totalClicks ?? null, 12)}
          previousLabel={previousLabel}
          showHeading={false}
        />

        <h2 className="sectionTitle">Imports</h2>
        <ImportPanel
          key={`ga4-${data.activePeriod.start}-${data.activePeriod.end}`}
          scopeLabel="the landing page"
          period={data.activePeriod}
          sources={ga4Sources}
          existing={data.imports.filter((f) => f.source === 'ga4')}
        />
        {shortioSources.length > 0 ? (
          <ImportPanel
            key={`shortio-${data.activePeriod.start}-${data.activePeriod.end}`}
            community={community2.slug}
            scopeLabel={`${community2.label}'s tracked links`}
            period={data.activePeriod}
            sources={shortioSources}
            existing={data.imports.filter(
              (f) => f.community === community2.slug && f.source === 'shortio',
            )}
          />
        ) : null}
      </div>
    </>
  );
}

/** What a past report has on file for this tab, for the period dropdown. */
function describeSources(hasGa4: boolean, hasShortio: boolean): string {
  if (hasGa4 && hasShortio) return 'GA4 + Short.io';
  if (hasGa4) return 'GA4 only';
  if (hasShortio) return 'Short.io only';
  return 'nothing filed';
}
