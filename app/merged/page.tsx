import { PageHeader } from '@/components/PageHeader';
import { getCommunity, importsFor } from '@/lib/groups';
import { LandingPageTraffic, CommunityShortioClicks } from '@/components/ImportedFigures';
import { ImportPanel } from '@/components/ImportPanel';
import { SOURCE_META } from '@/lib/imports';
import {
  GA4_FIGURES,
  communityShortio,
  entryWeekOptions,
  ga4Series,
  landingPageGa4,
  loadDashboard,
  shortioSeries,
} from '@/lib/dashboard';

export const dynamic = 'force-dynamic';

/**
 * Landing page & WADL: GA4 landing-page traffic and Community #2's Short.io
 * link data. Neither is WhatsApp community data — GA4 describes the website,
 * Short.io is Community #2's own tracked links — so nothing here is pooled
 * with the community reports. Untouched integrations; only the surrounding
 * page (member totals, community grid) moved to the Overview tab.
 */
export default async function LandingPageAndWadl({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week } = await searchParams;
  const data = await loadDashboard(week);

  const ga4Figures = landingPageGa4(data);
  const ga4SeriesByKey = Object.fromEntries(
    GA4_FIGURES.map((figure) => [figure.key, ga4Series(data, figure.pick)]),
  );

  const community2 = getCommunity('community-2')!;
  const shortioFigures = communityShortio(data, 'community-2');
  const clicksSeries = shortioSeries(data, 'community-2', (f) => f?.totalClicks ?? null);
  const community2Sources = importsFor('community-2').map((source) => SOURCE_META[source]);
  const community2Imports = data.imports.filter(
    (f) => f.community === 'community-2' && f.source === 'shortio',
  );

  return (
    <>
      <PageHeader eyebrow="Landing page & WADL" title="Landing page & WADL" weekStart={data.displayWeek} />

      <div className="content">
        <h2 className="sectionTitle">Landing page traffic · GA4</h2>
        <p className="chartNote" style={{ marginTop: -6 }}>
          The website's traffic, not any community's — GA4 has nothing to do with WhatsApp
          membership.
        </p>
        <LandingPageTraffic
          figures={ga4Figures}
          series={ga4SeriesByKey}
          emptyHint="Nothing imported for this week yet. Upload the GA4 export below."
        />
        <div style={{ marginTop: 14 }}>
          <ImportPanel
            scopeLabel="the landing page"
            weekOptions={entryWeekOptions()}
            defaultWeek={data.displayWeek}
            sources={[SOURCE_META.ga4]}
            existing={data.imports.filter((f) => f.source === 'ga4')}
          />
        </div>

        <h2 className="sectionTitle">Community #2's link clicks · Short.io</h2>
        <p className="chartNote" style={{ marginTop: -6 }}>
          Community #2's own tracked links specifically — not shared with, or summed against, any
          other community.
        </p>
        <CommunityShortioClicks
          figures={shortioFigures}
          clicksSeries={clicksSeries}
          emptyHint="Nothing imported for this week yet. Upload Community #2's Short.io export below."
        />
        {community2Sources.length > 0 ? (
          <div style={{ marginTop: 14 }}>
            <ImportPanel
              community="community-2"
              scopeLabel={community2.label}
              weekOptions={entryWeekOptions()}
              defaultWeek={data.displayWeek}
              sources={community2Sources}
              existing={community2Imports}
            />
          </div>
        ) : null}
      </div>
    </>
  );
}
