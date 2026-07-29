import type { LeadsBySource } from '@/lib/types';
import { formatExact, formatPercent } from '@/lib/metrics';

/**
 * Leads by source, as horizontal bars.
 *
 * These are nominal categories, so every bar wears the same accent — colouring
 * them by value would spend the identity channel re-encoding what bar length
 * already shows. Bars are 12px (well under the 24px cap), square at the
 * baseline and 4px rounded at the data end, with the value labelled at the tip.
 * Built in plain HTML: a chart library would add weight and no clarity.
 */
export function LeadsBySourceBars({
  rows,
  showConversion = true,
}: {
  rows: LeadsBySource[];
  showConversion?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <div className="chartEmpty">
        No registrations attributed to this group this week.
      </div>
    );
  }

  const max = Math.max(...rows.map((r) => r.leads), 1);

  return (
    <div className="hbars">
      {rows.map((row) => (
        <div key={row.source}>
          <div className="hbar__top">
            <span className="hbar__name">{row.source}</span>
            {showConversion && row.conversionRate !== null ? (
              <span className="hbar__sub">
                {formatPercent(row.conversionRate)} of {formatExact(row.clicks)} clicks
              </span>
            ) : null}
            <span className="hbar__val">{formatExact(row.leads)}</span>
          </div>
          <div
            className="hbar__track"
            role="img"
            aria-label={`${row.source}: ${formatExact(row.leads)} leads`}
          >
            <div
              className="hbar__fill"
              style={{ width: `${Math.max((row.leads / max) * 100, row.leads > 0 ? 2 : 0)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
