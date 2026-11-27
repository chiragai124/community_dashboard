import { parseISODate, toISODate } from './weeks';

/**
 * Manual date-range helpers for WhatsApp reports.
 *
 * Unlike Short.io/GA4 (still on the Monday-anchored week system in
 * lib/weeks.ts, untouched), a WhatsApp report's period is whatever start/end
 * date the user types in — not necessarily seven days, not necessarily
 * Monday-aligned. `toISODate`/`parseISODate` are genuinely date-generic (not
 * week-specific), so they're reused from lib/weeks.ts rather than duplicated.
 */

/**
 * How far the date pickers reach, in both directions.
 *
 * Deliberately fixed dates rather than anything derived from the data: a
 * calendar that stops at the last import can only ever file a report for a
 * period that already has data in it, which makes setting up next week's
 * period — or back-filling a week nobody exported — impossible. The range is
 * wide enough to cover both and narrow enough that a mistyped year (0025,
 * 20252) is still caught.
 */
export const PERIOD_MIN_DATE = '2020-01-01';
export const PERIOD_MAX_DATE = '2030-12-31';

export function isValidISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(parseISODate(value).getTime());
}

/** Is this a real date, and one the pickers are allowed to offer? */
export function isSelectableDate(value: string): boolean {
  // ISO dates sort lexicographically, so string comparison is the date
  // comparison here — no parsing needed beyond the validity check.
  return isValidISODate(value) && value >= PERIOD_MIN_DATE && value <= PERIOD_MAX_DATE;
}

/** The message shown when a date falls outside those bounds. */
export const OUT_OF_BOUNDS_MESSAGE =
  `Dates must fall between ${PERIOD_MIN_DATE} and ${PERIOD_MAX_DATE}.`;

/** Is `iso` within [start, end], inclusive of the entire end day? */
export function isInRange(iso: string, start: string, end: string): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  const startMs = parseISODate(start).getTime();
  const endMs = parseISODate(end).getTime() + 24 * 60 * 60 * 1000; // through end of that day
  return t >= startMs && t < endMs;
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** "14 Jul" */
export function formatShortDate(iso: string): string {
  const d = parseISODate(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "12 - 19 Aug 2026", collapsing the month/year when start and end share them. */
export function formatDateRange(start: string, end: string): string {
  const s = parseISODate(start);
  const e = parseISODate(end);
  const startMonth = MONTHS[s.getUTCMonth()];
  const endMonth = MONTHS[e.getUTCMonth()];
  const startYear = s.getUTCFullYear();
  const endYear = e.getUTCFullYear();
  if (startYear === endYear && startMonth === endMonth) {
    return `${s.getUTCDate()} - ${e.getUTCDate()} ${endMonth} ${endYear}`;
  }
  if (startYear === endYear) {
    return `${s.getUTCDate()} ${startMonth} - ${e.getUTCDate()} ${endMonth} ${endYear}`;
  }
  return `${s.getUTCDate()} ${startMonth} ${startYear} - ${e.getUTCDate()} ${endMonth} ${endYear}`;
}

export { toISODate, parseISODate };
