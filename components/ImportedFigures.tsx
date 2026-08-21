import type { Ga4Figures, LinkClicks, ShortioFigures } from '@/lib/types';
import { StatCard } from './StatCard';
import { Sparkline } from './charts';
import { formatExact } from '@/lib/metrics';
import { GA4_FIGURES } from '@/lib/dashboard';

/**
 * Landing-page traffic, from GA4. Deliberately not attributed to either
 * community — GA4 describes the website, not a WhatsApp community, so this
 * never says "Community #1" or "Community #2" anywhere near it.
 *
 * A figure with no uploaded file shows an em dash, not a zero. That distinction
 * is the whole point of the null handling upstream — "we haven't uploaded this
 * week's export" and "nobody visited" are different facts and must not look
 * the same on screen.
 */
export function LandingPageTraffic({
  figures,
  series,
  emptyHint,
}: {
  figures: Ga4Figures | null;
  /** One trailing series per figure key, for the sparklines. */
  series: Record<string, { week: string; value: number | null }[]>;
  emptyHint: string;
}) {
  const values = GA4_FIGURES.map((figure) => {
    const points = series[figure.key] ?? [];
    return {
      ...figure,
      value: figure.pick(figures),
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
  );
}

/**
 * Community #2's link data, from Short.io. Short.io is specifically Community
 * #2's own tracked links — not shared or generic, and not pooled with
 * anything — so this is always labelled as Community #2's, never presented
 * as if it applied to both communities.
 */
export function CommunityShortioClicks({
  figures,
  clicksSeries,
  emptyHint,
}: {
  figures: ShortioFigures | null;
  clicksSeries: { week: string; value: number | null }[];
  emptyHint: string;
}) {
  if (!figures) {
    return <div className="emptyState">{emptyHint}</div>;
  }

  const points = clicksSeries.filter((p) => p.value !== null).length >= 2 ? clicksSeries : null;

  return (
    <>
      <div className="grid grid--stats">
        <StatCard
          label="Link clicks"
          value={formatExact(figures.totalClicks)}
          hint="Short.io · Community #2 · this week"
        >
          {points ? <Sparkline points={points} /> : null}
        </StatCard>
      </div>
      {figures.links.length > 0 ? (
        <LinkClicksBars links={figures.links} total={figures.totalClicks} />
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
            {links.length === 1 ? '' : 's'} — Community #2
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
