import type { ReactNode } from 'react';
import type { ActivityLevel } from '@/lib/types';
import { formatSigned, formatSignedPercent } from '@/lib/metrics';

/**
 * Stat tile: label · value · delta · optional sparkline.
 *
 * The value uses proportional figures (tabular-nums looks loose at display
 * sizes); only table columns and axis ticks get tabular figures.
 */
export function StatCard({
  label,
  value,
  delta,
  deltaSuffix,
  hint,
  accent = false,
  children,
}: {
  label: string;
  value: string;
  /** Signed change vs the previous week. Direction sets the emphasis. */
  delta?: number | null;
  /** e.g. "vs last week". Always name the comparison period. */
  deltaSuffix?: string;
  hint?: string;
  accent?: boolean;
  children?: ReactNode;
}) {
  const hasDelta = delta !== null && delta !== undefined && Number.isFinite(delta);
  const direction = hasDelta ? (delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat') : 'flat';

  return (
    <div className={`stat${accent ? ' stat--accent' : ''}`}>
      <span className="stat__label">{label}</span>
      <span className={`stat__value${accent ? ' stat__value--accent' : ''}`}>{value}</span>
      {hasDelta ? (
        <span className="stat__delta">
          <span className={`delta delta--${direction}`}>
            <span className="delta__arrow" aria-hidden="true">
              {direction === 'up' ? '▲' : direction === 'down' ? '▼' : '■'}
            </span>{' '}
            {formatSigned(delta)}
          </span>
          {deltaSuffix ? <span className="muted">{deltaSuffix}</span> : null}
        </span>
      ) : hint ? (
        <span className="stat__hint">{hint}</span>
      ) : (
        <span className="stat__delta" />
      )}
      {children ? <div className="stat__spark">{children}</div> : null}
    </div>
  );
}

/** Same tile, but the delta is itself a percentage (growth rate, rate change). */
export function StatCardPercentDelta({
  label,
  value,
  deltaPct,
  deltaSuffix,
  hint,
  accent = false,
  children,
}: {
  label: string;
  value: string;
  deltaPct?: number | null;
  deltaSuffix?: string;
  hint?: string;
  accent?: boolean;
  children?: ReactNode;
}) {
  const hasDelta = deltaPct !== null && deltaPct !== undefined && Number.isFinite(deltaPct);
  const direction = hasDelta ? (deltaPct > 0 ? 'up' : deltaPct < 0 ? 'down' : 'flat') : 'flat';

  return (
    <div className={`stat${accent ? ' stat--accent' : ''}`}>
      <span className="stat__label">{label}</span>
      <span className={`stat__value${accent ? ' stat__value--accent' : ''}`}>{value}</span>
      {hasDelta ? (
        <span className="stat__delta">
          <span className={`delta delta--${direction}`}>
            <span className="delta__arrow" aria-hidden="true">
              {direction === 'up' ? '▲' : direction === 'down' ? '▼' : '■'}
            </span>{' '}
            {formatSignedPercent(deltaPct)}
          </span>
          {deltaSuffix ? <span className="muted">{deltaSuffix}</span> : null}
        </span>
      ) : hint ? (
        <span className="stat__hint">{hint}</span>
      ) : (
        <span className="stat__delta" />
      )}
      {children ? <div className="stat__spark">{children}</div> : null}
    </div>
  );
}

/**
 * Activity level. Ordinal (Low → High) on one hue's lightness steps, and the
 * word is always present — identity never rests on colour alone.
 */
export function ActivityBadge({ level }: { level: ActivityLevel | null }) {
  if (!level) {
    return (
      <span className="badge badge--activity-none">
        <span className="badge__tick" aria-hidden="true" />
        No entry
      </span>
    );
  }
  return (
    <span className={`badge badge--activity-${level.toLowerCase()}`}>
      <span className="badge__tick" aria-hidden="true" />
      {level}
    </span>
  );
}
