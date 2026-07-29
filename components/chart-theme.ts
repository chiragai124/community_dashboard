/**
 * Chart tokens. These mirror the CSS custom properties in app/globals.css —
 * Recharts needs literal values, so they are duplicated here deliberately.
 *
 * Contrast against the white chart surface, measured not eyeballed:
 *   ACCENT  #ed3a56 → 3.93:1   (clears the 3:1 floor for data marks)
 *   CONTEXT #8d94a1 → 3.05:1   (recessive, still clears 3:1)
 *   GRID    #e8e9eb → 1.21:1   (gridlines are not data marks; exempt)
 *
 * There is exactly one accent hue. Multi-series charts therefore carry identity
 * with position + direct end labels + a legend, never with extra hues: the
 * focused series is ACCENT, every other series is CONTEXT. See MultiGroupTrend.
 */

export const CHART = {
  ACCENT: '#ed3a56',
  ACCENT_INK: '#c22740',
  CONTEXT: '#8d94a1',
  GRID: '#e8e9eb',
  AXIS_TEXT: '#6b7280',
  SURFACE: '#ffffff',
  INK: '#0a0a0a',

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
