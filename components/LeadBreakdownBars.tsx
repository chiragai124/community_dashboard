import type { LeadBreakdownRow } from '@/lib/types';
import { formatExact, formatPercent } from '@/lib/metrics';

/**
 * A leads breakdown as horizontal bars — by university, or by country.
 *
 * Bars off a common baseline, sorted by count: the labels are a nominal category
 * with no inherent order, and length is the encoding people read most accurately.
 * University names are long, so the label sits above its own bar rather than
 * being squeezed into a left column.
 *
 * `missing` is stated rather than bucketed into an "Unknown" bar. A bar labelled
 * Unknown competes visually with real universities and reads as though it were
 * one of them.
 */
export function LeadBreakdownBars({
  title,
  subtitle,
  rows,
  missing,
  missingLabel,
  emptyHint,
}: {
  title: string;
  subtitle: string;
  rows: LeadBreakdownRow[];
  missing: number;
  /** A noun phrase, e.g. "no university recorded" — the verb is agreed here. */
  missingLabel: string;
  emptyHint: string;
}) {
  const max = Math.max(...rows.map((r) => r.leads), 1);

  return (
    <section className="card">
      <div className="card__head">
        <div>
          <div className="card__title">{title}</div>
          <div className="card__sub">{subtitle}</div>
        </div>
      </div>
      <div className="card__body">
        {rows.length === 0 ? (
          <div className="emptyState">{emptyHint}</div>
        ) : (
          <div className="hbars">
            {rows.map((row) => (
              <div key={row.label}>
                <div className="hbar__top">
                  <span className="hbar__name" title={row.label}>
                    {row.label}
                  </span>
                  <span className="hbar__val">
                    {formatExact(row.leads)}
                    <span className="hbar__sub"> · {formatPercent(row.sharePct, 0)}</span>
                  </span>
                </div>
                <div
                  className="hbar__track"
                  role="img"
                  aria-label={`${row.label}: ${formatExact(row.leads)} leads, ${formatPercent(row.sharePct, 0)}`}
                >
                  <div
                    className="hbar__fill"
                    style={{ width: `${Math.max((row.leads / max) * 100, 2)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {missing > 0 ? (
          <p className="chartNote">
            {formatExact(missing)} lead{missing === 1 ? ' has ' : 's have '}
            {missingLabel}, so {missing === 1 ? 'it is' : 'they are'} not in this breakdown.
            Shares are of the leads that do have one.
          </p>
        ) : null}
      </div>
    </section>
  );
}
