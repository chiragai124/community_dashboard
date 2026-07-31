import type { SentimentBreakdown, SentimentKey } from '@/lib/types';
import { SENTIMENT_KEYS } from '@/lib/types';
import { formatPercent } from '@/lib/metrics';

/**
 * The week's sentiment split, with example messages underneath.
 *
 * Form choice: a single stacked bar, not three separate bars and not a pie. The
 * three shares are parts of one whole, so one bar reads as a composition and
 * makes the balance legible at a glance; separate bars would invite reading them
 * as unrelated quantities, and a pie makes the two smaller slices hard to compare.
 *
 * The shares are drawn exactly as entered. When they don't sum to 100 the bar is
 * left short (or the overshoot is stated) rather than rescaled — rescaling would
 * present a data-entry problem as a finding.
 */

const SENTIMENT_LABELS: Record<SentimentKey, string> = {
  positive: 'Positive',
  neutral: 'Neutral',
  negative: 'Negative',
};

export function hasSentiment(sentiment: SentimentBreakdown | null | undefined): boolean {
  if (!sentiment) return false;
  return (
    sentiment.positivePct !== null ||
    sentiment.neutralPct !== null ||
    sentiment.negativePct !== null ||
    SENTIMENT_KEYS.some((key) => sentiment.examples[key].length > 0)
  );
}

function shareOf(sentiment: SentimentBreakdown, key: SentimentKey): number | null {
  if (key === 'positive') return sentiment.positivePct;
  if (key === 'neutral') return sentiment.neutralPct;
  return sentiment.negativePct;
}

export function SentimentPanel({
  sentiment,
  /** Shown in the card subtitle, e.g. "UK · week of 27 Jul". */
  subtitle,
}: {
  sentiment: SentimentBreakdown;
  subtitle: string;
}) {
  if (!hasSentiment(sentiment)) return null;

  const shares = SENTIMENT_KEYS.map((key) => ({
    key,
    label: SENTIMENT_LABELS[key],
    value: shareOf(sentiment, key),
    examples: sentiment.examples[key],
  }));

  const entered = shares.filter((s) => s.value !== null);
  const sum = entered.reduce((total, s) => total + (s.value ?? 0), 0);
  const hasBar = entered.length > 0;
  const withExamples = shares.filter((s) => s.examples.length > 0);

  return (
    <section className="card">
      <div className="card__head">
        <div>
          <div className="card__title">Sentiment</div>
          <div className="card__sub">{subtitle}</div>
        </div>
        {hasBar && Math.round(sum) !== 100 ? (
          <span className="badge badge--neutral" style={{ marginLeft: 'auto' }}>
            {formatPercent(sum, 0)} accounted for
          </span>
        ) : null}
      </div>

      <div className="card__body">
        {hasBar ? (
          <>
            <div
              className="sentBar"
              role="img"
              aria-label={entered
                .map((s) => `${s.label} ${formatPercent(s.value)}`)
                .join(', ')}
            >
              {shares.map((share) =>
                share.value === null || share.value === 0 ? null : (
                  <div
                    key={share.key}
                    className={`sentBar__seg sentBar__seg--${share.key}`}
                    style={{ width: `${Math.min(100, share.value)}%` }}
                  />
                ),
              )}
            </div>

            <div className="sentLegend">
              {shares.map((share) => (
                <span className="sentLegend__item" key={share.key}>
                  <span
                    className={`sentLegend__key sentLegend__key--${share.key}`}
                    aria-hidden="true"
                  />
                  <span className="sentLegend__label">{share.label}</span>
                  <span className="sentLegend__val">{formatPercent(share.value)}</span>
                </span>
              ))}
            </div>
          </>
        ) : (
          <p className="chartNote" style={{ marginTop: 0 }}>
            No percentages entered for this week — examples only.
          </p>
        )}

        {withExamples.length > 0 ? (
          <div className="sentQuotes">
            {withExamples.map((share) => (
              <div className="sentQuotes__group" key={share.key}>
                <div className="qual__fieldLabel">
                  {share.label} examples
                  {share.value !== null ? (
                    <span className="qual__inline"> ({formatPercent(share.value)})</span>
                  ) : null}
                </div>
                <ul className="sentQuotes__list">
                  {share.examples.map((quote) => (
                    <li className={`sentQuote sentQuote--${share.key}`} key={quote}>
                      {quote}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
