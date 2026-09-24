import type { DailyRow } from '../types';
import { normalizeKey, toNumber, type XlsxSheet } from '../xlsx';

/**
 * Finding a day-by-day breakdown inside an export, when it has one.
 *
 * Both Short.io and GA4 primarily report *totals for the window you exported*.
 * That is fine when a fresh export is uploaded every week, and useless when
 * it isn't: a total for "1–30 September" can't answer "what happened in the
 * last seven days" unless the file also lists the individual days.
 *
 * Some exports do. Short.io's workbook usually carries a per-day clicks
 * sheet, and a GA4 snapshot often includes a section broken down by date. So
 * this looks for one, and reports honestly when there isn't one — the caller
 * (lib/imports/resolve.ts) then carries figures forward whole and says so on
 * screen, rather than inventing a seven-day slice that the file never
 * contained.
 *
 * Nothing here throws. A missing or unreadable daily breakdown is the normal
 * case, not an error: the headline totals are what the upload is really for.
 */

/** Column headers that identify a date column. */
const DATE_HEADERS = [
  'date',
  'day',
  'nthday',
  'yyyymmdd',
  'datehour',
  'clickdate',
  'createdat',
  'period',
];

/**
 * GA4 writes dates as `YYYYMMDD`; Short.io as an ISO date, sometimes with a
 * time. Spreadsheet date *serials* are deliberately not accepted — a bare
 * number like `45900` is indistinguishable from a click count, and guessing
 * wrong would silently file a whole export under 2025-09-14.
 */
export function parseExportDate(raw: string): string | null {
  const value = raw.trim();
  if (value === '') return null;

  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const slashed = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(value);
  if (slashed) {
    return `${slashed[1]}-${slashed[2].padStart(2, '0')}-${slashed[3].padStart(2, '0')}`;
  }

  return null;
}

/** Is this header a date column? */
export function isDateHeader(key: string): boolean {
  return DATE_HEADERS.includes(key);
}

/**
 * Merge rows that land on the same day, summing each metric. GA4's
 * date-and-hour sections produce 24 rows per day; Short.io can repeat a day
 * per link.
 */
export function mergeDailyRows(rows: DailyRow[]): DailyRow[] {
  const byDate = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const existing = byDate.get(row.date) ?? {};
    for (const [key, value] of Object.entries(row.values)) {
      existing[key] = (existing[key] ?? 0) + value;
    }
    byDate.set(row.date, existing);
  }
  return [...byDate.entries()]
    .map(([date, values]) => ({ date, values }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/* -------------------------------------------------------------- Short.io -- */

const CLICK_HEADERS = ['clicks', 'totalclicks', 'clickcount', 'humanclicks', 'visits', 'count'];

/**
 * A per-day clicks series from whichever sheet carries one.
 *
 * Every sheet is scanned rather than only the one named "Click statistics":
 * the workbook's sheet names vary between Short.io plans, and a sheet either
 * has a date column next to a clicks column or it doesn't — which is a more
 * reliable test than its title.
 */
export function readShortioDaily(sheets: XlsxSheet[]): DailyRow[] {
  const rows: DailyRow[] = [];

  for (const sheet of sheets) {
    for (let i = 0; i < Math.min(sheet.rows.length, 25); i += 1) {
      const headers = sheet.rows[i].map(normalizeKey);
      const dateAt = headers.findIndex(isDateHeader);
      const clicksAt = headers.findIndex((h) => CLICK_HEADERS.includes(h));
      if (dateAt === -1 || clicksAt === -1 || dateAt === clicksAt) continue;

      for (const row of sheet.rows.slice(i + 1)) {
        const date = parseExportDate(row[dateAt] ?? '');
        const clicks = toNumber(row[clicksAt] ?? '');
        if (date === null || clicks === null) continue;
        rows.push({ date, values: { clicks } });
      }
      // One table per sheet is enough; a second header row inside the same
      // sheet would be a different breakdown of the same days, and adding it
      // would double every count.
      break;
    }
  }

  return mergeDailyRows(rows);
}

/* ------------------------------------------------------------------ GA4 -- */

/** One parsed section of a GA4 snapshot — see lib/imports/ga4.ts. */
export interface Ga4Section {
  header: string[];
  rows: string[][];
}

const GA4_METRIC_ALIASES: { key: string; aliases: string[] }[] = [
  { key: 'activeUsers', aliases: ['activeusers', 'users', 'totalusers'] },
  { key: 'newUsers', aliases: ['newusers', 'newusers1', 'firsttimeusers'] },
  { key: 'sessions', aliases: ['sessions', 'totalsessions'] },
];

/**
 * A per-day series from whichever snapshot sections are broken down by date.
 *
 * Several sections can each contribute a different metric for the same days
 * (one dated section for new users, another for sessions), so every dated
 * section is read and the results merged by date.
 */
export function readGa4Daily(sections: Ga4Section[]): DailyRow[] {
  const rows: DailyRow[] = [];

  for (const section of sections) {
    const headers = section.header.map(normalizeKey);
    const dateAt = headers.findIndex(isDateHeader);
    if (dateAt === -1) continue;

    const metrics = GA4_METRIC_ALIASES.map((metric) => ({
      key: metric.key,
      at: headers.findIndex((h) => metric.aliases.includes(h)),
    })).filter((m) => m.at !== -1 && m.at !== dateAt);
    if (metrics.length === 0) continue;

    for (const row of section.rows) {
      const date = parseExportDate(row[dateAt] ?? '');
      if (date === null) continue;
      const values: Record<string, number> = {};
      for (const metric of metrics) {
        const value = toNumber(row[metric.at] ?? '');
        if (value !== null) values[metric.key] = value;
      }
      if (Object.keys(values).length > 0) rows.push({ date, values });
    }
  }

  return mergeDailyRows(rows);
}

/* ------------------------------------------------------------- selecting -- */

/** The days in `daily` that fall inside [start, end], inclusive. */
export function daysWithin(daily: DailyRow[], start: string, end: string): DailyRow[] {
  return daily.filter((row) => row.date >= start && row.date <= end);
}

/**
 * The last `count` days the series actually has data for, oldest first.
 * Used when an export predates the period being reported on: its most recent
 * days are the closest thing it holds to "this week".
 */
export function lastDays(daily: DailyRow[], count: number): DailyRow[] {
  return daily.slice(Math.max(0, daily.length - count));
}

/** Sum one metric across a set of days, or null when none of them reported it. */
export function sumMetric(days: DailyRow[], key: string): number | null {
  let total = 0;
  let seen = false;
  for (const day of days) {
    const value = day.values[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      total += value;
      seen = true;
    }
  }
  return seen ? total : null;
}
