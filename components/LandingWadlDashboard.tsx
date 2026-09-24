import type { ResolvedImport } from '@/lib/imports';
import type { Ga4Figures, ShortioFigures, TrendRow } from '@/lib/types';
import { StatCard } from './StatCard';
import { LinkClicksBars } from './ImportedFigures';
import { MultiGroupTrend, SingleTrendChart } from './charts';
import { formatExact } from '@/lib/metrics';
import { formatDateRange } from '@/lib/period';
import { GA4_FIGURES } from '@/lib/dashboard';

/**
 * Landing page & WADL as a dashboard rather than a list of numbers: two
 * panels side by side under one date-range header, Community #2's
 * scholarship-link clicks on the left and website traffic on the right —
 * the order the weekly report itself uses, leading with the links because
 * that is where most of the measurable movement comes from.
 *
 * They sit together because they are read together — traffic arrives on the
 * landing page and leaves through a tracked link — but they are kept in
 * separate panels, never pooled or plotted on shared axes, because they count
 * different things about different populations. Side by side is the strongest
 * claim this data supports; one combined chart would imply a relationship the
 * numbers can't carry.
 *
 * The tiles are the same StatCard used for member counts everywhere else, so
 * a number here reads exactly like a number anywhere else on the report.
 */

export interface LandingWadlProps {
  period: { start: string; end: string };
  ga4: ResolvedImport<Ga4Figures>;
  shortio: ResolvedImport<ShortioFigures>;
  previousGa4: Ga4Figures | null;
  previousShortio: ShortioFigures | null;
  /** One row per filed report, oldest first, keyed by GA4 metric. */
  ga4Rows: TrendRow[];
  /** Total clicks per filed report, oldest first. */
  shortioPoints: { week: string; value: number | null }[];
  /** e.g. "vs 9 - 15 Sep" — names which report the arrows compare against. */
  previousLabel: string | null;
  /**
   * False on the Landing page tab, whose own page title already says this.
   * The Overview needs it, since this is one section among several there.
   */
  showHeading?: boolean;
}

/**
 * Where a panel's figures came from, when it isn't simply "this period's
 * upload". Carried-forward numbers get the warning treatment on purpose:
 * they are last period's totals standing in for this one's, and a reader who
 * doesn't notice that will draw a false conclusion from a flat line.
 */
function Provenance({ resolved }: { resolved: ResolvedImport<unknown> }) {
  if (!resolved.note) return null;
  const isStandIn = resolved.origin === 'carried-forward';
  return (
    <p className={isStandIn ? 'formMsg formMsg--warn' : 'chartNote'} role={isStandIn ? 'status' : undefined}>
      {isStandIn ? <strong>Carried forward: </strong> : null}
      {resolved.note}
    </p>
  );
}

export function LandingWadlDashboard({
  period,
  ga4,
  shortio,
  previousGa4,
  previousShortio,
  ga4Rows,
  shortioPoints,
  previousLabel,
  showHeading = true,
}: LandingWadlProps) {
  const deltaSuffix = previousLabel ? `vs ${previousLabel}` : undefined;

  const ga4Values = GA4_FIGURES.map((figure) => {
    const value = figure.pick(ga4.figures);
    const previous = figure.pick(previousGa4);
    return {
      ...figure,
      value,
      // Null, not zero, when either side is missing: an arrow needs two real
      // numbers, and "no comparison available" must not render as "no change".
      delta: value !== null && previous !== null ? value - previous : null,
    };
  });

  // A line needs at least two reports with a value in them; with one on file
  // the chart would be a single dot in an empty box.
  const ga4HasTrend =
    ga4Rows.filter((row) => GA4_FIGURES.some((f) => typeof row[f.key] === 'number')).length >= 2;
  const shortioHasTrend = shortioPoints.filter((p) => p.value !== null).length >= 2;

  const clicks = shortio.figures?.totalClicks ?? null;
  const clicksDelta =
    clicks !== null && previousShortio ? clicks - previousShortio.totalClicks : null;

  return (
    <section className="wadl">
      {showHeading ? (
        <div className="wadl__head">
          <h2 className="sectionTitle" style={{ margin: 0 }}>
            Scholarship leads (Short.io) &amp; landing page (GA4)
          </h2>
          <span className="wadl__period">{formatDateRange(period.start, period.end)}</span>
        </div>
      ) : null}

      <div className="wadl__panels">
        {/* -------------------------------------------------- Short.io --- */}
        <section className="card wadl__panel">
          <div className="card__head">
            <div>
              <div className="card__title">WhatsApp link clicks</div>
              <div className="card__sub">Short.io · Community #2&rsquo;s tracked links</div>
            </div>
          </div>
          <div className="card__body">
            {shortio.figures === null ? (
              <div className="emptyState">
                No Short.io workbook has been uploaded yet. Import one to fill this panel.
              </div>
            ) : (
              <>
                <div className="grid grid--stats">
                  <StatCard
                    label="Total link clicks"
                    value={formatExact(clicks)}
                    delta={clicksDelta}
                    deltaSuffix={deltaSuffix}
                    hint={clicksDelta === null ? 'Short.io · this period' : undefined}
                    accent
                  />
                </div>

                {shortioHasTrend ? (
                  <div style={{ marginTop: 16 }}>
                    <SingleTrendChart
                      points={shortioPoints}
                      seriesLabel="Link clicks"
                      height={180}
                      wash
                    />
                    <p className="chartNote">One point per filed report, oldest first.</p>
                  </div>
                ) : (
                  <p className="chartNote">
                    The trend line appears once a second report has been filed.
                  </p>
                )}

                <Provenance resolved={shortio} />

                {shortio.figures.links.length > 0 ? (
                  <LinkClicksBars
                    links={shortio.figures.links}
                    total={shortio.figures.totalClicks}
                  />
                ) : (
                  <p className="chartNote">
                    This export had no per-link breakdown, so only the total is shown.
                  </p>
                )}
              </>
            )}
          </div>
        </section>

        {/* ------------------------------------------------------- GA4 --- */}
        <section className="card wadl__panel">
          <div className="card__head">
            <div>
              <div className="card__title">Website traffic</div>
              <div className="card__sub">
                GA4 · the landing page, not either WhatsApp community
              </div>
            </div>
          </div>
          <div className="card__body">
            {ga4.figures === null ? (
              <div className="emptyState">
                No GA4 snapshot has been uploaded yet. Import one to fill this panel.
              </div>
            ) : (
              <>
                <div className="grid grid--stats">
                  {ga4Values.map((figure) => (
                    <StatCard
                      key={figure.key}
                      label={figure.label}
                      value={formatExact(figure.value)}
                      delta={figure.delta}
                      deltaSuffix={deltaSuffix}
                      hint={figure.delta === null ? figure.hint : undefined}
                    />
                  ))}
                </div>

                {ga4HasTrend ? (
                  <div style={{ marginTop: 16 }}>
                    <MultiGroupTrend
                      rows={ga4Rows}
                      series={GA4_FIGURES.map((f) => ({ key: f.key, label: f.label }))}
                      metricLabel="Landing page"
                      initialFocus="sessions"
                      height={240}
                    />
                    <p className="chartNote">
                      One point per filed report, oldest first. Pick a metric in the legend to bring
                      it forward.
                    </p>
                  </div>
                ) : (
                  <p className="chartNote">
                    The trend line appears once a second report has been filed.
                  </p>
                )}

                <Provenance resolved={ga4} />
              </>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}
