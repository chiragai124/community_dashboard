'use client';

import { useMemo, useState } from 'react';
import type { GroupSlug, MetricKey } from '@/lib/types';
import { singularize } from '@/lib/groups';
import { MultiGroupTrend, SingleTrendChart, SmallMultiplesTrend, type MultiRow, type MultiSeries, type Unit } from './charts';

/**
 * Trends: one metric at a time over a 4–8 week window, viewed as all five
 * groups overlaid, as small multiples, or one group on its own.
 *
 * All the data for every metric is already in props, so switching metric, view
 * or window is instant and needs no round-trip.
 */

export interface TrendMetric {
  key: MetricKey;
  label: string;
  unit: Unit;
  description: string;
}

type ViewMode = 'overlay' | 'multiples' | 'single';

export function TrendsView({
  metrics,
  rowsByMetric,
  series,
  defaultGroup,
  seriesNoun = 'groups',
}: {
  metrics: TrendMetric[];
  /** Full-window rows per metric, oldest week first. */
  rowsByMetric: Record<string, MultiRow[]>;
  series: MultiSeries[];
  defaultGroup: GroupSlug | string;
  /** What the series are called — "groups", "segments", "communities". */
  seriesNoun?: string;
}) {
  // With one series there is nothing to overlay or facet, so the view toggle is
  // hidden and it opens on the single-series chart.
  const multi = series.length > 1;

  const [metricKey, setMetricKey] = useState<MetricKey>(metrics[0]?.key ?? 'totalMembers');
  const [view, setView] = useState<ViewMode>(multi ? 'overlay' : 'single');
  const [group, setGroup] = useState<string>(defaultGroup);
  const [weeks, setWeeks] = useState<4 | 8>(8);

  const metric = metrics.find((m) => m.key === metricKey) ?? metrics[0];
  const allRows = rowsByMetric[metricKey] ?? [];
  const rows = useMemo(() => allRows.slice(-weeks), [allRows, weeks]);

  const singlePoints = useMemo(
    () =>
      rows.map((row) => ({
        week: String(row.week),
        value: typeof row[group] === 'number' ? (row[group] as number) : null,
      })),
    [rows, group],
  );

  const groupLabel = series.find((s) => s.key === group)?.label ?? group;

  return (
    <>
      <section className="card">
        <div className="card__head" style={{ flexWrap: 'wrap', rowGap: 10 }}>
          <div>
            <div className="card__title">Metric</div>
            <div className="card__sub">{metric?.description}</div>
          </div>
          <div className="row" style={{ marginLeft: 'auto' }}>
            <div className="segmented" role="group" aria-label="Metric">
              {metrics.map((m) => (
                <button
                  type="button"
                  key={m.key}
                  className={`segmented__btn${m.key === metricKey ? ' segmented__btn--active' : ''}`}
                  aria-pressed={m.key === metricKey}
                  onClick={() => setMetricKey(m.key)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="card__head" style={{ flexWrap: 'wrap', rowGap: 10 }}>
          {multi ? (
            <div className="segmented" role="group" aria-label="View">
              <button
                type="button"
                className={`segmented__btn${view === 'overlay' ? ' segmented__btn--active' : ''}`}
                aria-pressed={view === 'overlay'}
                onClick={() => setView('overlay')}
              >
                All {series.length} overlaid
              </button>
              <button
                type="button"
                className={`segmented__btn${view === 'multiples' ? ' segmented__btn--active' : ''}`}
                aria-pressed={view === 'multiples'}
                onClick={() => setView('multiples')}
              >
                Small multiples
              </button>
              <button
                type="button"
                className={`segmented__btn${view === 'single' ? ' segmented__btn--active' : ''}`}
                aria-pressed={view === 'single'}
                onClick={() => setView('single')}
              >
                Single {singularize(seriesNoun)}
              </button>
            </div>
          ) : null}

          {view === 'single' && multi ? (
            <div className="segmented" role="group" aria-label="Group">
              {series.map((s) => (
                <button
                  type="button"
                  key={s.key}
                  className={`segmented__btn${s.key === group ? ' segmented__btn--active' : ''}`}
                  aria-pressed={s.key === group}
                  onClick={() => setGroup(s.key)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          ) : null}

          <div className="segmented" role="group" aria-label="Window" style={{ marginLeft: 'auto' }}>
            {([4, 8] as const).map((n) => (
              <button
                type="button"
                key={n}
                className={`segmented__btn${weeks === n ? ' segmented__btn--active' : ''}`}
                aria-pressed={weeks === n}
                onClick={() => setWeeks(n)}
              >
                {n} weeks
              </button>
            ))}
          </div>
        </div>

        <div className="card__body">
          {view === 'overlay' ? (
            <MultiGroupTrend
              key={`${metricKey}-${weeks}`}
              rows={rows}
              series={series}
              unit={metric?.unit ?? 'count'}
              height={360}
              metricLabel={metric?.label ?? 'This metric'}
              initialFocus={group}
            />
          ) : view === 'multiples' ? (
            <SmallMultiplesTrend
              rows={rows}
              series={series}
              unit={metric?.unit ?? 'count'}
              height={104}
            />
          ) : (
            <>
              <div style={{ marginBottom: 10, fontSize: 13, fontWeight: 600 }}>
                {groupLabel} · {metric?.label}
              </div>
              <SingleTrendChart
                points={singlePoints}
                seriesLabel={`${groupLabel} ${metric?.label.toLowerCase() ?? ''}`}
                unit={metric?.unit ?? 'count'}
                height={340}
                wash
              />
            </>
          )}
        </div>
      </section>
    </>
  );
}
