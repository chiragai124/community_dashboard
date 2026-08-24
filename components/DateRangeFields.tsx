/**
 * Two date inputs (start/end), shared by every import panel so WhatsApp,
 * Short.io and GA4 all present the same picker rather than three different
 * date-selection UIs.
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
          onChange={(e) => onStartChange(e.target.value)}
          disabled={disabled}
        />
      </label>

      <label className="field">
        <span className="field__label">{endLabel}</span>
        <input
          type="date"
          value={end}
          onChange={(e) => onEndChange(e.target.value)}
          disabled={disabled}
        />
      </label>
    </div>
  );
}
