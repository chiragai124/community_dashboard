import type { MemberSourceKey, NewMembersBySource } from '@/lib/types';
import { MEMBER_SOURCE_KEYS, MEMBER_SOURCE_LABELS } from '@/lib/types';
import { formatExact, formatPercent } from '@/lib/metrics';

/**
 * Where a week's new members came from.
 *
 * Bars rather than a stacked total, because the useful comparison is between
 * sources, and length off a common baseline is read far more accurately than the
 * segment lengths of a stack. The share is printed next to each count so the mix
 * is available without measuring.
 *
 * All three counts are hand-entered. If they don't add up to the week's new-member
 * figure, that discrepancy is shown rather than hidden — the form warns at entry
 * time, and this says so again next to the numbers.
 */
export function MemberSourceSplit({
  split,
  /** The week's new-member figure, for the reconciliation note. */
  newMembers,
  title = 'New members by source',
  subtitle,
}: {
  split: NewMembersBySource;
  newMembers: number | null;
  title?: string;
  subtitle: string;
}) {
  const rows = MEMBER_SOURCE_KEYS.map((key: MemberSourceKey) => ({
    key,
    label: MEMBER_SOURCE_LABELS[key],
    value: split[key],
  }));

  const entered = rows.filter((r) => r.value !== null);
  if (entered.length === 0) return null;

  const total = entered.reduce((sum, r) => sum + (r.value ?? 0), 0);
  const max = Math.max(...entered.map((r) => r.value ?? 0), 1);
  const mismatch = newMembers !== null && total !== newMembers;

  return (
    <section className="card">
      <div className="card__head">
        <div>
          <div className="card__title">{title}</div>
          <div className="card__sub">{subtitle}</div>
        </div>
        <span className="badge badge--neutral" style={{ marginLeft: 'auto' }}>
          {formatExact(total)} split
        </span>
      </div>
      <div className="card__body">
        <div className="hbars">
          {rows.map((row) => (
            <div key={row.key}>
              <div className="hbar__top">
                <span className="hbar__name">{row.label}</span>
                <span className="hbar__val">
                  {formatExact(row.value)}
                  {row.value !== null && total > 0 ? (
                    <span className="hbar__sub"> · {formatPercent((row.value / total) * 100, 0)}</span>
                  ) : null}
                </span>
              </div>
              <div
                className="hbar__track"
                role="img"
                aria-label={`${row.label}: ${formatExact(row.value)} new members`}
              >
                <div
                  className="hbar__fill"
                  style={{
                    width:
                      row.value === null
                        ? '0%'
                        : `${Math.max((row.value / max) * 100, row.value > 0 ? 2 : 0)}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        {mismatch ? (
          <p className="chartNote">
            The split adds up to {formatExact(total)}, while the week records{' '}
            {formatExact(newMembers)} new members. Shown as entered — neither figure is
            adjusted to fit the other.
          </p>
        ) : null}
      </div>
    </section>
  );
}
