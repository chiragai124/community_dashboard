import type { ImportedWeek, LinkClicks } from '@/lib/types';
import { StatCard } from './StatCard';
import { Sparkline } from './charts';
import { formatExact } from '@/lib/metrics';
import { IMPORTED_FIGURES } from '@/lib/dashboard';

/**
 * The imported numbers, in the same tile style as the manual metrics: four stat
 * cards with a sparkline each, then clicks per link path.
 *
 * A figure with no uploaded file shows an em dash, not a zero. That distinction
 * is the whole point of the null handling upstream — "we haven't uploaded this
 * week's export" and "nobody clicked" are different facts and must not look the
 * same on screen.
 */
export function ImportedFigures({
  week,
  series,
  emptyHint,
}: {
  week: ImportedWeek;
  /** One trailing series per figure key, for the sparklines. */
  series: Record<string, { week: string; value: number | null }[]>;
  /** Shown in place of the tiles when nothing at all has been imported. */
  emptyHint: string;
}) {
  const values = IMPORTED_FIGURES.map((figure) => {
    const points = series[figure.key] ?? [];
    return {
      ...figure,
      value: figure.pick(week),
      // A sparkline needs two points to be a line. With one week uploaded it
      // would render an empty box under every figure, so it waits until there is
      // a trend to show.
      points: points.filter((p) => p.value !== null).length >= 2 ? points : null,
    };
  });
  const anyValue = values.some((v) => v.value !== null);

  if (!anyValue) {
    return <div className="emptyState">{emptyHint}</div>;
  }

  return (
    <>
      <div className="grid grid--stats">
        {values.map((figure) => (
          <StatCard
            key={figure.key}
            label={figure.label}
            value={formatExact(figure.value)}
            hint={figure.hint}
          >
            {figure.points ? <Sparkline points={figure.points} /> : null}
          </StatCard>
        ))}
      </div>
      {week.shortio && week.shortio.links.length > 0 ? (
        <LinkClicksBars links={week.shortio.links} total={week.shortio.totalClicks} />
      ) : null}
    </>
  );
}

/**
 * Clicks per link path, as horizontal bars.
 *
 * Bars are the right form here: the paths are a nominal category with no order of
 * their own, and length is the one encoding people read accurately. Sorted by
 * clicks so the ranking is the first thing visible, and the path is the label —
 * it is what the user recognises the link by.
 */
export function LinkClicksBars({
  links,
  total,
  limit = 12,
}: {
  links: LinkClicks[];
  total: number;
  limit?: number;
}) {
  const shown = links.slice(0, limit);
  const hidden = links.length - shown.length;
  const max = Math.max(...shown.map((l) => l.clicks), 1);

  return (
    <section className="card" style={{ marginTop: 14 }}>
      <div className="card__head">
        <div>
          <div className="card__title">Clicks by link</div>
          <div className="card__sub">
            {formatExact(total)} total clicks across {links.length} link
            {links.length === 1 ? '' : 's'}
          </div>
        </div>
      </div>
      <div className="card__body">
        <div className="hbars">
          {shown.map((link) => (
            <div key={link.path}>
              <div className="hbar__top">
                <span className="hbar__name" title={link.path}>
                  {link.path}
                </span>
                <span className="hbar__val">{formatExact(link.clicks)}</span>
              </div>
              <div
                className="hbar__track"
                role="img"
                aria-label={`${link.path}: ${formatExact(link.clicks)} clicks`}
              >
                <div
                  className="hbar__fill"
                  style={{ width: `${Math.max((link.clicks / max) * 100, 2)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
        {hidden > 0 ? (
          <p className="chartNote">
            {hidden} further link{hidden === 1 ? '' : 's'} not shown.
          </p>
        ) : null}
      </div>
    </section>
  );
}
