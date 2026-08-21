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

export function isValidISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(parseISODate(value).getTime());
}

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
