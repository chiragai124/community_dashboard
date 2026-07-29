import type { TrafficFunnelTotals } from '@/lib/dashboard';
import { formatExact, formatPercent } from '@/lib/metrics';

/**
 * The traffic/funnel layer over the three automated sources:
 *
 *   Short.io clicks  →  GA4 sessions  →  Sheet registrations
 *
 * Windows are deliberately labelled per stage: Short.io reports lifetime clicks
 * while sessions and registrations are this-week figures, so only the
 * sessions→leads conversion is an honest weekly rate. A stage whose source
 * isn't declared for the scope simply doesn't render.
 */
export function TrafficFunnel({
  totals,
  subtitle,
}: {
  totals: TrafficFunnelTotals;
  subtitle: string;
}) {
  const stages = [
    {
      key: 'clicks',
      label: 'Link clicks',
      sub: 'Short.io · lifetime',
      value: totals.clicksLifetime,
    },
    {
      key: 'sessions',
      label: 'Site sessions',
      sub: 'GA4 · this week',
      value: totals.sessionsWeek,
    },
    {
      key: 'leads',
      label: 'Registrations',
      sub: 'Sheets · this week',
      value: totals.leadsWeek,
    },
  ].filter((stage) => stage.value !== null);

  if (stages.length === 0) return null;

  return (
    <section className="card">
      <div className="card__head">
        <div>
          <div className="card__title">Traffic &amp; funnel</div>
          <div className="card__sub">{subtitle}</div>
        </div>
        {totals.sessionToLeadPct !== null ? (
          <span className="badge badge--live" style={{ marginLeft: 'auto' }}>
            {formatPercent(totals.sessionToLeadPct)} session → registration
          </span>
        ) : null}
      </div>
      <div className="card__body">
        <div className="funnel">
          {stages.map((stage, index) => (
            <div className="funnel__stage" key={stage.key}>
              {index > 0 ? (
                <span className="funnel__arrow" aria-hidden="true">
                  →
                </span>
              ) : null}
              <div className="funnel__cell">
                <span className="stat__label">{stage.label}</span>
                <span className="stat__value">{formatExact(stage.value)}</span>
                <span className="stat__hint">{stage.sub}</span>
              </div>
            </div>
          ))}
        </div>
        <p className="chartNote">
          Short.io reports lifetime clicks per link, so clicks and the weekly stages are not
          the same window — only session → registration is a weekly rate.
        </p>
      </div>
    </section>
  );
}
