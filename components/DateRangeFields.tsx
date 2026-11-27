import { PERIOD_MAX_DATE, PERIOD_MIN_DATE } from '@/lib/period';

/**
 * Two date inputs (start/end), shared by every import panel so WhatsApp,
 * Short.io and GA4 all present the same picker rather than three different
 * date-selection UIs.
 *
 * Both carry explicit bounds. The browser's calendar opens on whatever date
 * the field already holds, so a dashboard whose last import was in August
 * opens on August — but every month either side of it is reachable, up to the
 * end of 2030. The bounds are the same everywhere and owe nothing to what has
 * been imported: a period can be set up before its data exists, and a past
 * week can be back-filled long after.
 */
export function DateRangeFields({
  start,
  end,
  onStartChange,
  onEndChange,
  startLabel = 'Start date',
  endLabel = 'End date',
  disabled = false,
}: {
  start: string;
  end: string;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
  startLabel?: string;
  endLabel?: string;
  disabled?: boolean;
}) {
  return (
    <div className="impRow__controls">
      <label className="field">
        <span className="field__label">{startLabel}</span>
        <input
          type="date"
          value={start}
          min={PERIOD_MIN_DATE}
          max={PERIOD_MAX_DATE}
          onChange={(e) => onStartChange(e.target.value)}
          disabled={disabled}
        />
      </label>

      <label className="field">
        <span className="field__label">{endLabel}</span>
        <input
          type="date"
          value={end}
          min={PERIOD_MIN_DATE}
          max={PERIOD_MAX_DATE}
          onChange={(e) => onEndChange(e.target.value)}
          disabled={disabled}
        />
      </label>
    </div>
  );
}
