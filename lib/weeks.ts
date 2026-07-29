/**
 * Week helpers. A "week" in this dashboard is always Monday→Sunday and is
 * identified by its Monday as a YYYY-MM-DD string. Everything is computed in
 * UTC so a user's timezone can never shift an entry into the wrong week.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseISODate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/** The Monday of the week containing `date`. */
export function weekStartOf(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // getUTCDay: 0 = Sunday. Shift so Monday = 0.
  const offset = (d.getUTCDay() + 6) % 7;
  return toISODate(new Date(d.getTime() - offset * DAY_MS));
}

/** The current week's Monday. */
export function currentWeekStart(): string {
  return weekStartOf(new Date());
}

export function addWeeks(weekStart: string, count: number): string {
  return toISODate(new Date(parseISODate(weekStart).getTime() + count * 7 * DAY_MS));
}

export function previousWeek(weekStart: string): string {
  return addWeeks(weekStart, -1);
}

/** The Sunday that closes the week starting at `weekStart`. */
export function weekEnd(weekStart: string): string {
  return toISODate(new Date(parseISODate(weekStart).getTime() + 6 * DAY_MS));
}

/**
 * The last `count` week-starts ending at `endWeek` (inclusive), oldest first.
 */
export function lastNWeeks(count: number, endWeek: string = currentWeekStart()): string[] {
  const weeks: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) weeks.push(addWeeks(endWeek, -i));
  return weeks;
}

/** Is `iso` inside the Monday→Sunday window starting at `weekStart`? */
export function isInWeek(iso: string, weekStart: string): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  const start = parseISODate(weekStart).getTime();
  return t >= start && t < start + 7 * DAY_MS;
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

/** Axis-friendly week tick: "14 Jul". */
export function formatWeekTick(weekStart: string): string {
  return formatShortDate(weekStart);
}

/** "14–20 Jul 2026", collapsing the month when the week doesn't cross one. */
export function formatWeekRange(weekStart: string): string {
  const start = parseISODate(weekStart);
  const end = parseISODate(weekEnd(weekStart));
  const startMonth = MONTHS[start.getUTCMonth()];
  const endMonth = MONTHS[end.getUTCMonth()];
  const year = end.getUTCFullYear();
  if (startMonth === endMonth) {
    return `${start.getUTCDate()}–${end.getUTCDate()} ${endMonth} ${year}`;
  }
  return `${start.getUTCDate()} ${startMonth} – ${end.getUTCDate()} ${endMonth} ${year}`;
}

/** ISO-8601 week number, for display next to the date range. */
export function isoWeekNumber(weekStart: string): number {
  const d = parseISODate(weekStart);
  // The Thursday of this week determines the ISO year and week number.
  const thursday = new Date(d.getTime() + 3 * DAY_MS);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  return Math.ceil(((thursday.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
}

/** "W31 · 27 Jul – 2 Aug 2026" */
export function formatWeekLabel(weekStart: string): string {
  return `W${isoWeekNumber(weekStart)} · ${formatWeekRange(weekStart)}`;
}
