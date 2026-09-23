import type {
  CommunitySlug,
  DailyRow,
  Ga4Figures,
  ImportedFile,
  LinkClicks,
  ShortioFigures,
} from '../types';
import type { ReportPeriod } from '../reports';
import { formatDateRange } from '../period';
import { daysWithin, lastDays, sumMetric } from './daily';

/**
 * Deciding which uploaded export answers for a given report period — and
 * saying plainly how it was decided.
 *
 * Uploading a fresh Short.io workbook and GA4 snapshot every single week is
 * the thing most likely to be skipped, and a skipped upload used to leave the
 * panel blank. So a period with no export of its own falls back to the most
 * recent earlier one. How faithful that fallback is depends entirely on what
 * the file contains:
 *
 *   - **re-sliced** — the export carried day-by-day rows, so the figures
 *     really are this period's, summed from exactly the right days.
 *   - **carried forward** — the export only had window totals, so the
 *     previous period's numbers are shown unchanged.
 *
 * The second is a stand-in, not a measurement, and it is always labelled as
 * one. Quietly reprinting last week's totals as if they were this week's is
 * precisely the failure this design exists to avoid.
 */

export type FigureOrigin =
  /** An export was uploaded for this period (or one overlapping it). */
  | 'uploaded'
  /** An export with daily rows was summed over exactly this period's days. */
  | 'resliced'
  /** An earlier export's window totals, shown unchanged for want of anything newer. */
  | 'carried-forward'
  /** Nothing has ever been uploaded for this source. */
  | 'none';

export interface ResolvedImport<T> {
  figures: T | null;
  origin: FigureOrigin;
  /** The upload the figures came from. */
  from: ImportedFile | null;
  /** One sentence naming where these numbers came from, for display under them. */
  note: string | null;
}

/** The range an upload covers. Legacy week-keyed rows report their Monday–Sunday week. */
export function coveredRange(file: ImportedFile): ReportPeriod | null {
  if (file.periodStart && file.periodEnd) {
    return { start: file.periodStart, end: file.periodEnd };
  }
  return null;
}

function overlapDays(a: ReportPeriod, b: ReportPeriod): number {
  const start = a.start > b.start ? a.start : b.start;
  const end = a.end < b.end ? a.end : b.end;
  if (end < start) return 0;
  const ms = new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000)) + 1;
}

/** How many days a period spans, inclusive. */
export function periodLength(period: ReportPeriod): number {
  return overlapDays(period, period);
}

/**
 * Pick the upload that answers for `period`, and say how.
 *
 * `rebuild` turns a set of days back into this source's figures — the one
 * piece that differs between GA4 and Short.io, since each has its own shape.
 * It returns null when the daily rows carry nothing usable, which sends the
 * caller back to carrying the totals forward.
 */
function resolve<T>(
  files: ImportedFile[],
  period: ReportPeriod,
  read: (file: ImportedFile) => T | null | undefined,
  rebuild: (file: ImportedFile, days: ReturnType<typeof daysWithin>) => T | null,
): ResolvedImport<T> {
  const candidates = files
    .map((file) => ({ file, range: coveredRange(file) }))
    .filter((c): c is { file: ImportedFile; range: ReportPeriod } => c.range !== null)
    .filter((c) => read(c.file) != null)
    .sort((a, b) => (a.range.end < b.range.end ? -1 : 1));

  if (candidates.length === 0) {
    return { figures: null, origin: 'none', from: null, note: null };
  }

  // An export overlapping this period is always preferred, most overlap first;
  // a tie goes to the later one, which is the more recent upload of the two.
  const overlapping = candidates
    .map((c) => ({ ...c, overlap: overlapDays(c.range, period) }))
    .filter((c) => c.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || (a.range.end < b.range.end ? 1 : -1));

  if (overlapping.length > 0) {
    const best = overlapping[0];
    const exact = best.range.start === period.start && best.range.end === period.end;

    // Covers this period but spans more than it — with daily rows, narrow it
    // down to exactly the days asked for rather than over-reporting.
    if (!exact && best.file.daily && best.file.daily.length > 0) {
      const days = daysWithin(best.file.daily, period.start, period.end);
      const rebuilt = days.length > 0 ? rebuild(best.file, days) : null;
      if (rebuilt) {
        return {
          figures: rebuilt,
          origin: 'resliced',
          from: best.file,
          note:
            `Summed from the ${days.length} day(s) of ${formatDateRange(period.start, period.end)} ` +
            `inside an export covering ${formatDateRange(best.range.start, best.range.end)}.`,
        };
      }
    }

    return {
      figures: read(best.file) as T,
      origin: 'uploaded',
      from: best.file,
      note: exact
        ? null
        : `From an export covering ${formatDateRange(best.range.start, best.range.end)}, which ` +
          'overlaps this period. Upload one for this exact period to replace it.',
    };
  }

  // Nothing covers this period: fall back to the most recent earlier export.
  const earlier = candidates.filter((c) => c.range.end < period.start);
  const fallback = earlier[earlier.length - 1];
  if (!fallback) {
    return { figures: null, origin: 'none', from: null, note: null };
  }

  if (fallback.file.daily && fallback.file.daily.length > 0) {
    // An export filed under an earlier period can still *contain* this
    // period's days — exporting a whole month and filing the first week out
    // of it is normal. Those days are a real measurement of this period, not
    // a stand-in, so they're preferred over the export's trailing days and
    // said so plainly.
    const within = daysWithin(fallback.file.daily, period.start, period.end);
    const trailing = lastDays(fallback.file.daily, periodLength(period));
    const days = within.length > 0 ? within : trailing;
    const rebuilt = days.length > 0 ? rebuild(fallback.file, days) : null;
    if (rebuilt) {
      return {
        figures: rebuilt,
        // Days from inside the period are a measurement; the export's
        // trailing days are a stand-in, and must carry the same warning
        // treatment as carrying totals forward whole.
        origin: within.length > 0 ? 'resliced' : 'carried-forward',
        from: fallback.file,
        note:
          within.length > 0
            ? `No export was uploaded for this period, but the one covering ` +
              `${formatDateRange(fallback.range.start, fallback.range.end)} carries day-by-day ` +
              `rows that include ${days.length} day(s) of it — these figures are summed from ` +
              `those days.`
            : `No export uploaded for this period, and the most recent one ` +
              `(${formatDateRange(fallback.range.start, fallback.range.end)}) has no rows inside ` +
              `it. These are its last ${days.length} day(s), ` +
              `${formatDateRange(days[0].date, days[days.length - 1].date)} — a stand-in, not ` +
              `this period's figures.`,
      };
    }
  }

  return {
    figures: read(fallback.file) as T,
    origin: 'carried-forward',
    from: fallback.file,
    note:
      `No export uploaded for this period. These are the totals from ` +
      `${formatDateRange(fallback.range.start, fallback.range.end)}, carried forward unchanged — ` +
      `that export has no day-by-day rows, so it can't be narrowed to this period. Upload a ` +
      `fresh export to replace them.`,
  };
}

/* ------------------------------------------------------------------ GA4 -- */

/**
 * GA4 figures summed over a set of days, or null when those days carry no
 * usable metric.
 *
 * Exported because the same slice happens twice: once at upload, when an
 * export covering a wider window is filed under a narrower period, and again
 * later when a period with no export of its own reuses an earlier one. Both
 * must produce the same number from the same days.
 */
export function ga4FromDays(days: DailyRow[]): Ga4Figures | null {
  const figures: Ga4Figures = {
    activeUsers: sumMetric(days, 'activeUsers'),
    newUsers: sumMetric(days, 'newUsers'),
    sessions: sumMetric(days, 'sessions'),
  };
  const anything =
    figures.activeUsers !== null || figures.newUsers !== null || figures.sessions !== null;
  return anything ? figures : null;
}

/** Short.io figures for a set of days. See `resolveShortio` on why links can't be sliced. */
export function shortioFromDays(days: DailyRow[], links: LinkClicks[]): ShortioFigures | null {
  const total = sumMetric(days, 'clicks');
  return total === null ? null : { totalClicks: total, links };
}

/** Landing-page traffic for a period. GA4 is never community-scoped. */
export function resolveGa4(files: ImportedFile[], period: ReportPeriod): ResolvedImport<Ga4Figures> {
  return resolve<Ga4Figures>(
    files.filter((f) => f.source === 'ga4'),
    period,
    (file) => file.ga4 ?? null,
    (_file, days) => ga4FromDays(days),
  );
}

/* ------------------------------------------------------------- Short.io -- */

/**
 * Community #2's link clicks for a period.
 *
 * A re-slice can only rebuild the *total*: the daily sheet records clicks per
 * day, not clicks per day per link, so there is no way to narrow the per-link
 * breakdown to a subset of days. The breakdown from the source export is kept
 * (it is still the best available ranking of which links people click) and
 * the note says which window it describes, so the two figures are never read
 * as covering the same days.
 */
export function resolveShortio(
  files: ImportedFile[],
  community: CommunitySlug,
  period: ReportPeriod,
): ResolvedImport<ShortioFigures> {
  const resolved = resolve<ShortioFigures>(
    files.filter((f) => f.source === 'shortio' && f.community === community),
    period,
    (file) => file.shortio ?? null,
    (file, days) => shortioFromDays(days, file.shortio?.links ?? []),
  );

  if (resolved.origin === 'resliced' && (resolved.figures?.links.length ?? 0) > 0) {
    const range = resolved.from ? coveredRange(resolved.from) : null;
    return {
      ...resolved,
      note:
        `${resolved.note ?? ''} The per-link breakdown below is not split by day in the export, so ` +
        `it still describes the whole file` +
        (range ? ` (${formatDateRange(range.start, range.end)})` : '') +
        '.',
    };
  }

  return resolved;
}
