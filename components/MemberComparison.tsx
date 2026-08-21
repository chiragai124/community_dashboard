import { formatExact, formatSigned, formatSignedPercent } from '@/lib/metrics';

/**
 * "How many members did we gain since the last report" — a dedicated,
 * explicit section rather than a delta folded into a stat tile, since that
 * comparison is exactly what gets asked after every report lands.
 *
 * `previousMembers` is null when there's no prior filed period to compare
 * against (e.g. the very first report for a scope) — shown as an honest
 * "nothing to compare yet" rather than a misleading flat 0.
 */
export function MemberComparison({
  currentMembers,
  previousMembers,
  previousLabel,
}: {
  currentMembers: number;
  previousMembers: number | null;
  /** e.g. "5 - 11 Aug 2026", describing which report `previousMembers` came from. */
  previousLabel: string | null;
}) {
  if (previousMembers === null) {
    return (
      <section className="card">
        <div className="card__body">
          <p className="chartNote" style={{ margin: 0 }}>
            No previous report on file yet — this comparison appears once a second report has
            been filed.
          </p>
        </div>
      </section>
    );
  }

  const delta = currentMembers - previousMembers;
  const growthPct = previousMembers > 0 ? (delta / previousMembers) * 100 : null;
  const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';

  return (
    <section className="card">
      <div className="card__body">
        <div className="memberSum">
          <div className="memberSum__item">
            <span className="stat__label">Previous report{previousLabel ? ` · ${previousLabel}` : ''}</span>
            <span className="stat__value">{formatExact(previousMembers)}</span>
          </div>
          <span className="memberSum__op" aria-hidden="true">
            →
          </span>
          <div className="memberSum__item memberSum__item--total">
            <span className="stat__label">Now</span>
            <span className="stat__value stat__value--accent">{formatExact(currentMembers)}</span>
          </div>
          <div className="memberSum__item">
            <span className="stat__label">Change</span>
            <span className={`delta delta--${direction}`} style={{ fontSize: 20 }}>
              <span className="delta__arrow" aria-hidden="true">
                {direction === 'up' ? '▲' : direction === 'down' ? '▼' : '■'}
              </span>{' '}
              {formatSigned(delta)}
              {growthPct !== null ? ` (${formatSignedPercent(growthPct)})` : ''}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
