/**
 * Chart tokens. These mirror the CSS custom properties in app/globals.css —
 * Recharts needs literal values, so they are duplicated here deliberately.
 *
 * There is exactly one accent hue (the report's red). Multi-series charts
 * carry identity with position + direct end labels + a legend, never with
 * extra hues: the focused series is ACCENT, every other series is CONTEXT.
 */

export const CHART = {
  ACCENT: '#e10600',
  ACCENT_INK: '#a80500',
  CONTEXT: '#9b948c',
  GRID: '#eae6e1',
  AXIS_TEXT: '#6b6560',
  SURFACE: '#ffffff',
  INK: '#1a1a1a',

  /** 2px lines, round caps. */
  LINE_WIDTH: 2,
  CONTEXT_LINE_WIDTH: 1.5,
  /** ≥8px markers means r ≥ 4. */
  DOT_R: 4,
  ACTIVE_DOT_R: 5,
  /** Markers carry a 2px ring in the surface colour. */
  RING_WIDTH: 2,
} as const;

export const AXIS_TICK = {
  fontSize: 11,
  fill: CHART.AXIS_TEXT,
} as const;

/** Shared Recharts margins. Right margin leaves room for direct end labels. */
export const MARGIN_WITH_LABELS = { top: 12, right: 62, bottom: 4, left: 0 } as const;
export const MARGIN_PLAIN = { top: 12, right: 16, bottom: 4, left: 0 } as const;
export const MARGIN_COMPACT = { top: 8, right: 10, bottom: 0, left: 0 } as const;
