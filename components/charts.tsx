'use client';

import { useMemo, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AXIS_TICK,
  CHART,
  MARGIN_COMPACT,
  MARGIN_PLAIN,
  MARGIN_WITH_LABELS,
} from './chart-theme';
import { TooltipShell, type RechartsTooltipProps, type TooltipRow } from './ChartTooltip';
import { formatCount, formatExact, formatPercent } from '@/lib/metrics';
import { formatWeekLabel, formatWeekTick } from '@/lib/weeks';
import type { TrendRow } from '@/lib/types';

/**
 * Recharts types its render props (`Tooltip content`, `LabelList content`,
 * `Line dot`) far wider than the values it actually passes — payload arrays are
 * readonly, coordinates are `string | number`. The three helpers below are the
 * only places that widen to `any`, and each narrows immediately.
 */
type RechartsRenderProps = any; // eslint-disable-line @typescript-eslint/no-explicit-any

function asTooltipProps(raw: RechartsRenderProps): RechartsTooltipProps {
  return raw as RechartsTooltipProps;
}

function coord(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

export type Unit = 'count' | 'percent';

export interface TrendPoint {
  week: string;
  value: number | null;
}

export interface MultiSeries {
  key: string;
  label: string;
}

export type MultiRow = TrendRow;

/* -------------------------------------------------------------- formatting */

function formatValue(value: number | null | undefined, unit: Unit): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return unit === 'percent' ? formatPercent(value) : formatExact(value);
}

function tickFormatter(unit: Unit) {
  return (value: number) =>
    unit === 'percent' ? `${Math.round(value)}%` : formatCount(value);
}

/** Percent axes start at zero; growth can go negative, so let it auto-floor. */
function yDomain(unit: Unit, values: number[]): [number | 'auto', number | 'auto'] {
  const min = values.length > 0 ? Math.min(...values) : 0;
  return [min < 0 ? 'auto' : 0, 'auto'];
}

function lastIndexWithValue(points: { value: number | null }[]): number {
  for (let i = points.length - 1; i >= 0; i -= 1) {
    if (points[i].value !== null && points[i].value !== undefined) return i;
  }
  return -1;
}

/* ------------------------------------------------------------- end labels */

/**
 * Renders a direct label at the series' final point only — never a number on
 * every point. Text wears ink tokens, not the series colour.
 */
function makeEndLabel(text: string, targetIndex: number, emphasis: boolean) {
  function EndLabel(props: RechartsRenderProps) {
    const x = coord(props?.x);
    const y = coord(props?.y);
    // Recharts calls this for every point; only the last one gets a label.
    if (props?.index !== targetIndex || x === null || y === null) return <g />;
    return (
      <text
        x={x + 9}
        y={y}
        dy={4}
        fontSize={11.5}
        fontWeight={emphasis ? 700 : 500}
        fill={emphasis ? CHART.INK : CHART.AXIS_TEXT}
      >
        {text}
      </text>
    );
  }
  return EndLabel;
}

/**
 * Which series get a direct end label.
 *
 * End labels only work when the lines separate at the right edge. Rather than
 * stacking colliding labels (which detaches them from their line and reads as
 * noise), predict each label's y position from the data and drop any that would
 * land within `MIN_GAP` px of one already kept. The focused series always keeps
 * its label, and the legend carries identity for anything dropped.
 */
const MIN_LABEL_GAP = 15;

function pickEndLabels(
  series: MultiSeries[],
  rows: MultiRow[],
  height: number,
  focusedKey: string | null,
): Set<string> {
  const kept = new Set<string>();
  if (rows.length === 0) return kept;

  const lastRow = rows[rows.length - 1];
  const entries = series
    .map((s) => ({ key: s.key, value: lastRow[s.key] }))
    .filter((e): e is { key: string; value: number } => typeof e.value === 'number');
  if (entries.length === 0) return kept;

  const allValues = rows.flatMap((row) =>
    series.map((s) => row[s.key]).filter((v): v is number => typeof v === 'number'),
  );
  const max = Math.max(...allValues, 0);
  const min = Math.min(...allValues, 0);
  const span = max - min || 1;
  // Plot area ≈ height minus the chart margins and the x-axis band.
  const plotHeight = Math.max(40, height - MARGIN_WITH_LABELS.top - 30);
  const yOf = (value: number) => MARGIN_WITH_LABELS.top + ((max - value) / span) * plotHeight;

  // Focused first so it always wins its slot, then the rest top-down.
  const ordered = [
    ...entries.filter((e) => e.key === focusedKey),
    ...entries.filter((e) => e.key !== focusedKey).sort((a, b) => b.value - a.value),
  ];

  const takenY: number[] = [];
  for (const entry of ordered) {
    const y = yOf(entry.value);
    if (takenY.every((t) => Math.abs(t - y) >= MIN_LABEL_GAP)) {
      kept.add(entry.key);
      takenY.push(y);
    }
  }
  return kept;
}

/* ------------------------------------------------------- single-series line */

/**
 * One metric over time. A single series needs no legend box — the card title
 * says what is plotted — so identity comes from the title plus the end label.
 */
export function SingleTrendChart({
  points,
  seriesLabel,
  unit = 'count',
  height = 220,
  wash = false,
  endLabel = true,
}: {
  points: TrendPoint[];
  seriesLabel: string;
  unit?: Unit;
  height?: number;
  wash?: boolean;
  endLabel?: boolean;
}) {
  const values = points
    .map((p) => p.value)
    .filter((v): v is number => typeof v === 'number');

  if (values.length === 0) {
    return (
      <div className="chartEmpty" style={{ height }}>
        No {seriesLabel.toLowerCase()} recorded for this window yet.
      </div>
    );
  }

  const target = lastIndexWithValue(points);
  const lastValue = points[target]?.value ?? null;

  return (
    <div className="chartFrame">
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={points} margin={endLabel ? MARGIN_WITH_LABELS : MARGIN_PLAIN}>
          <CartesianGrid stroke={CHART.GRID} strokeWidth={1} vertical={false} />
          <XAxis
            dataKey="week"
            tickFormatter={formatWeekTick}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: CHART.GRID }}
            interval="preserveStartEnd"
            minTickGap={16}
          />
          <YAxis
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={46}
            domain={yDomain(unit, values)}
            tickFormatter={tickFormatter(unit)}
          />
          <Tooltip
            cursor={{ stroke: CHART.CONTEXT, strokeWidth: 1 }}
            content={(raw: RechartsRenderProps) => {
              const props = asTooltipProps(raw);
              if (!props.active || !props.payload?.length) return null;
              const rows: TooltipRow[] = [
                {
                  name: seriesLabel,
                  value: formatValue(Number(props.payload[0].value), unit),
                  color: CHART.ACCENT,
                  emphasis: true,
                },
              ];
              return <TooltipShell head={formatWeekLabel(String(props.label))} rows={rows} />;
            }}
          />
          {wash ? (
            <Area
              dataKey="value"
              stroke="none"
              fill={CHART.ACCENT}
              fillOpacity={0.1}
              isAnimationActive={false}
              connectNulls
            />
          ) : null}
          <Line
            dataKey="value"
            name={seriesLabel}
            stroke={CHART.ACCENT}
            strokeWidth={CHART.LINE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
            type="linear"
            isAnimationActive={false}
            connectNulls={false}
            dot={{
              r: CHART.DOT_R,
              fill: CHART.ACCENT,
              stroke: CHART.SURFACE,
              strokeWidth: CHART.RING_WIDTH,
            }}
            activeDot={{
              r: CHART.ACTIVE_DOT_R,
              fill: CHART.ACCENT,
              stroke: CHART.SURFACE,
              strokeWidth: CHART.RING_WIDTH,
            }}
          >
            {endLabel && target >= 0 ? (
              <LabelList
                dataKey="value"
                content={makeEndLabel(formatValue(lastValue, unit), target, true)}
              />
            ) : null}
          </Line>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ------------------------------------------------- multi-series focus+context */

/**
 * All five groups on one shared axis (never two y-scales).
 *
 * With a single brand accent available, hue cannot separate five series — so it
 * doesn't try to. Every series is drawn in the recessive context grey and the
 * selected one is drawn in the accent on top, with direct end labels and a
 * legend carrying identity. Click a legend chip to move the focus.
 */
export function MultiGroupTrend({
  rows,
  series,
  unit = 'count',
  height = 300,
  initialFocus = null,
  metricLabel,
}: {
  rows: MultiRow[];
  series: MultiSeries[];
  unit?: Unit;
  height?: number;
  initialFocus?: string | null;
  metricLabel: string;
}) {
  const [focused, setFocused] = useState<string | null>(initialFocus);

  const labelled = useMemo(
    () => pickEndLabels(series, rows, height, focused),
    [series, rows, height, focused],
  );

  const allValues = rows.flatMap((row) =>
    series.map((s) => row[s.key]).filter((v): v is number => typeof v === 'number'),
  );

  if (allValues.length === 0) {
    return (
      <div className="chartEmpty" style={{ height }}>
        No {metricLabel.toLowerCase()} recorded for this window yet.
      </div>
    );
  }

  // Context lines first, focused line last, so the focus sits on top.
  const ordered = [
    ...series.filter((s) => s.key !== focused),
    ...series.filter((s) => s.key === focused),
  ];

  const lastRow = rows[rows.length - 1];

  return (
    <div className="chartFrame">
      <div className="legend" style={{ marginBottom: 12 }}>
        {series.map((s) => {
          const isActive = focused === s.key;
          return (
            <button
              type="button"
              key={s.key}
              className={`legendChip${isActive ? ' legendChip--active' : ''}`}
              aria-pressed={isActive}
              onClick={() => setFocused(isActive ? null : s.key)}
            >
              <span className="legendChip__key" />
              {s.label}
              <span className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatValue(lastRow?.[s.key] as number | null, unit)}
              </span>
            </button>
          );
        })}
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={rows} margin={MARGIN_WITH_LABELS}>
          <CartesianGrid stroke={CHART.GRID} strokeWidth={1} vertical={false} />
          <XAxis
            dataKey="week"
            tickFormatter={formatWeekTick}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: CHART.GRID }}
            interval="preserveStartEnd"
            minTickGap={16}
          />
          <YAxis
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={46}
            domain={yDomain(unit, allValues)}
            tickFormatter={tickFormatter(unit)}
          />
          <Tooltip
            cursor={{ stroke: CHART.CONTEXT, strokeWidth: 1 }}
            content={(raw: RechartsRenderProps) => {
              const props = asTooltipProps(raw);
              if (!props.active || !props.payload?.length) return null;
              const rows2: TooltipRow[] = [...props.payload]
                .map((item) => {
                  const key = String(item.dataKey ?? '');
                  const match = series.find((s) => s.key === key);
                  return {
                    name: match?.label ?? key,
                    rawValue: typeof item.value === 'number' ? item.value : null,
                    value: formatValue(
                      typeof item.value === 'number' ? item.value : null,
                      unit,
                    ),
                    color: key === focused ? CHART.ACCENT : CHART.CONTEXT,
                    emphasis: key === focused,
                  };
                })
                .sort((a, b) => (b.rawValue ?? -Infinity) - (a.rawValue ?? -Infinity))
                .map(({ name, value, color, emphasis }) => ({ name, value, color, emphasis }));
              return (
                <TooltipShell head={formatWeekLabel(String(props.label))} rows={rows2} />
              );
            }}
          />
          {ordered.map((s) => {
            const isFocused = s.key === focused;
            const target = lastIndexWithValue(
              rows.map((row) => ({
                value: typeof row[s.key] === 'number' ? (row[s.key] as number) : null,
              })),
            );
            return (
              <Line
                key={s.key}
                dataKey={s.key}
                name={s.label}
                stroke={isFocused ? CHART.ACCENT : CHART.CONTEXT}
                strokeWidth={isFocused ? CHART.LINE_WIDTH : CHART.CONTEXT_LINE_WIDTH}
                strokeLinecap="round"
                strokeLinejoin="round"
                type="linear"
                isAnimationActive={false}
                connectNulls={false}
                dot={false}
                activeDot={{
                  r: CHART.ACTIVE_DOT_R,
                  fill: isFocused ? CHART.ACCENT : CHART.CONTEXT,
                  stroke: CHART.SURFACE,
                  strokeWidth: CHART.RING_WIDTH,
                }}
              >
                {labelled.has(s.key) && target >= 0 ? (
                  <LabelList
                    dataKey={s.key}
                    content={makeEndLabel(s.label, target, isFocused)}
                  />
                ) : null}
              </Line>
            );
          })}
        </ComposedChart>
      </ResponsiveContainer>

      <p className="chartNote">
        {focused
          ? `${series.find((s) => s.key === focused)?.label} highlighted. Click its chip again to clear.`
          : 'Click a group above to highlight its line. Hover the chart for every group at once.'}
      </p>
    </div>
  );
}

/* --------------------------------------------------------- small multiples */

/**
 * One mini chart per group on a shared y scale, so panel heights are directly
 * comparable. This is the honest way to show five series at once when only one
 * accent hue exists — no colour ambiguity at all.
 */
export function SmallMultiplesTrend({
  rows,
  series,
  unit = 'count',
  height = 96,
}: {
  rows: MultiRow[];
  series: MultiSeries[];
  unit?: Unit;
  height?: number;
}) {
  const allValues = rows.flatMap((row) =>
    series.map((s) => row[s.key]).filter((v): v is number => typeof v === 'number'),
  );

  if (allValues.length === 0) {
    return <div className="chartEmpty">Nothing recorded for this window yet.</div>;
  }

  const max = Math.max(...allValues);
  const min = Math.min(...allValues, 0);
  const lastRow = rows[rows.length - 1];

  return (
    <>
      <div className="grid grid--small-multiples">
        {series.map((s) => {
          const points: TrendPoint[] = rows.map((row) => ({
            week: row.week,
            value: typeof row[s.key] === 'number' ? (row[s.key] as number) : null,
          }));
          return (
            <div className="smallMultiple" key={s.key}>
              <div className="smallMultiple__head">
                <span className="smallMultiple__name">{s.label}</span>
                <span className="smallMultiple__val">
                  {formatValue(lastRow?.[s.key] as number | null, unit)}
                </span>
              </div>
              <ResponsiveContainer width="100%" height={height}>
                <ComposedChart data={points} margin={MARGIN_COMPACT}>
                  <CartesianGrid stroke={CHART.GRID} strokeWidth={1} vertical={false} />
                  <XAxis dataKey="week" hide />
                  <YAxis hide domain={[min, max]} />
                  <Tooltip
                    cursor={{ stroke: CHART.CONTEXT, strokeWidth: 1 }}
                    content={(raw: RechartsRenderProps) => {
                      const props = asTooltipProps(raw);
                      if (!props.active || !props.payload?.length) return null;
                      return (
                        <TooltipShell
                          head={formatWeekLabel(String(props.label))}
                          rows={[
                            {
                              name: s.label,
                              value: formatValue(Number(props.payload[0].value), unit),
                              color: CHART.ACCENT,
                              emphasis: true,
                            },
                          ]}
                        />
                      );
                    }}
                  />
                  <Area
                    dataKey="value"
                    stroke="none"
                    fill={CHART.ACCENT}
                    fillOpacity={0.1}
                    isAnimationActive={false}
                    connectNulls
                  />
                  <Line
                    dataKey="value"
                    stroke={CHART.ACCENT}
                    strokeWidth={CHART.LINE_WIDTH}
                    strokeLinecap="round"
                    type="linear"
                    isAnimationActive={false}
                    connectNulls={false}
                    dot={false}
                    activeDot={{
                      r: CHART.DOT_R,
                      fill: CHART.ACCENT,
                      stroke: CHART.SURFACE,
                      strokeWidth: CHART.RING_WIDTH,
                    }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          );
        })}
      </div>
      <p className="chartNote">
        All five panels share one y scale, so panel heights are directly comparable.
      </p>
    </>
  );
}

/* ------------------------------------------------------------------ sparkline */

/** 8-point trend for a stat tile: recessive line, accent dot on the latest point. */
export function Sparkline({ points, height = 34 }: { points: TrendPoint[]; height?: number }) {
  const values = points.map((p) => p.value).filter((v): v is number => typeof v === 'number');
  if (values.length < 2) return null;
  const target = lastIndexWithValue(points);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={points} margin={{ top: 4, right: 5, bottom: 2, left: 0 }}>
        <Line
          dataKey="value"
          stroke={CHART.CONTEXT}
          strokeWidth={1.75}
          strokeLinecap="round"
          type="linear"
          isAnimationActive={false}
          connectNulls
          dot={(props: RechartsRenderProps) => {
            const { index, key } = props ?? {};
            const cx = coord(props?.cx);
            const cy = coord(props?.cy);
            // Only the latest point gets a marker; the rest of the line is bare.
            if (index !== target || cx === null || cy === null) {
              return <g key={key ?? `spark-${index}`} />;
            }
            return (
              <circle
                key={key ?? 'spark-last'}
                cx={cx}
                cy={cy}
                r={CHART.DOT_R}
                fill={CHART.ACCENT}
                stroke={CHART.SURFACE}
                strokeWidth={CHART.RING_WIDTH}
              />
            );
          }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
