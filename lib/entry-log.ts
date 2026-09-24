import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ReportPeriod } from './reports';
import { isValidISODate } from './period';
import { readJsonObject, vercelBlobEnabled, writeJsonObject } from './vercel-blob';

/**
 * An append-only log of hand-entered numbers, each one filed against a report
 * period — the shape shared by every manual figure in this dashboard: total
 * members, leads added to the CRM, and the Instagram broadcast channel's
 * member count.
 *
 * **Each entry names the range it is for, rather than a single date it was
 * entered on.** That is the whole design, and it replaces an earlier one that
 * stored a single `enteredAt` and worked out which report a figure belonged
 * to by comparing it against period boundaries. That inference broke on the
 * cadence this report actually runs: Wednesday to Wednesday means consecutive
 * periods share a date, and a figure dated on that shared date matched both
 * of them. Leads got counted twice, and "vs. last report" found no baseline
 * at all. A range is not ambiguous, so none of that can happen.
 *
 * Reading a figure back is therefore an exact lookup on the period, not a
 * date comparison — see `entryForPeriod`.
 *
 * Same dual-backend pattern as lib/imports/store.ts: Vercel Blob when
 * BLOB_READ_WRITE_TOKEN is set (required on Vercel, whose filesystem is
 * read-only outside `/tmp`), a local JSON file otherwise — the zero-config
 * default for `npm run dev`.
 */

const DATA_DIR = path.join(process.cwd(), 'data');

/** One hand-entered reading, for one report period. */
export interface LogEntry<Scope extends string = string> {
  /** Which series this belongs to — a community slug, or a fixed key for a single-series log. */
  scope: Scope;
  value: number;
  /** The report period this figure is for. */
  periodStart: string;
  periodEnd: string;
  /** When it was saved, for "entered 2 days ago" display. */
  recordedAt: string;
}

export interface EntryLog<Scope extends string> {
  /** Every entry, every scope, oldest period first. */
  getEntries(): Promise<LogEntry<Scope>[]>;
  /**
   * Record one reading for one period. Saving the same scope + period again
   * replaces that entry (correcting a figure) rather than adding a second.
   */
  saveEntry(scope: Scope, value: number, period: ReportPeriod): Promise<LogEntry<Scope>>;
}

function sortEntries<S extends string>(entries: LogEntry<S>[]): LogEntry<S>[] {
  return [...entries].sort((a, b) =>
    a.periodStart < b.periodStart ? -1 : a.periodStart > b.periodStart ? 1 : 0,
  );
}

/**
 * Read one stored row, accepting both shapes.
 *
 * Rows written before periods were explicit carry only `enteredAt`. Under the
 * rule this report uses — a date names the START of the period it opens —
 * such a row is read as opening a period on that date. `entryForPeriod` then
 * still matches it to a real period by containment, so existing history keeps
 * reading rather than silently disappearing.
 */
function normalizeRow<Scope extends string>(
  raw: unknown,
  isScope: (value: unknown) => value is Scope,
): LogEntry<Scope> | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isScope(r.scope)) return null;

  const start = String(r.periodStart ?? '');
  const end = String(r.periodEnd ?? '');
  const legacy = String(r.enteredAt ?? '');

  let periodStart: string;
  let periodEnd: string;
  if (isValidISODate(start) && isValidISODate(end) && end >= start) {
    periodStart = start;
    periodEnd = end;
  } else if (isValidISODate(legacy)) {
    periodStart = legacy;
    periodEnd = legacy;
  } else {
    return null;
  }

  return {
    scope: r.scope,
    value: Math.max(0, Math.round(Number(r.value) || 0)),
    periodStart,
    periodEnd,
    recordedAt: String(r.recordedAt ?? new Date().toISOString()),
  };
}

/**
 * Build a log stored at `fileName`. `isScope` rejects rows whose scope is no
 * longer a real one — a community removed from lib/groups.ts, say — since
 * those would otherwise contribute figures no page can attribute.
 */
export function createEntryLog<Scope extends string>({
  fileName,
  isScope,
}: {
  fileName: string;
  isScope: (value: unknown) => value is Scope;
}): EntryLog<Scope> {
  const storeFile = path.join(DATA_DIR, fileName);

  async function readLocalFile(): Promise<unknown> {
    try {
      return JSON.parse(await fs.readFile(storeFile, 'utf8'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  async function getEntries(): Promise<LogEntry<Scope>[]> {
    const raw = vercelBlobEnabled()
      ? await readJsonObject<unknown>(fileName, [])
      : await readLocalFile();
    if (!Array.isArray(raw)) return [];
    return sortEntries(
      raw
        .map((row) => normalizeRow<Scope>(row, isScope))
        .filter((e): e is LogEntry<Scope> => e !== null),
    );
  }

  async function write(entries: LogEntry<Scope>[]): Promise<void> {
    const sorted = sortEntries(entries);
    if (vercelBlobEnabled()) {
      await writeJsonObject(fileName, sorted);
      return;
    }
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(storeFile, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
  }

  async function saveEntry(
    scope: Scope,
    value: number,
    period: ReportPeriod,
  ): Promise<LogEntry<Scope>> {
    const entry: LogEntry<Scope> = {
      scope,
      value: Math.max(0, Math.round(value)),
      periodStart: period.start,
      periodEnd: period.end,
      recordedAt: new Date().toISOString(),
    };
    const current = await getEntries();
    const others = current.filter(
      (e) => !(e.scope === scope && e.periodStart === period.start && e.periodEnd === period.end),
    );
    await write([...others, entry]);
    return entry;
  }

  return { getEntries, saveEntry };
}

/* ---------------------------------------------------------------- selectors */

/** One scope's history, oldest period first. */
export function historyOf<S extends string>(entries: LogEntry<S>[], scope: S): LogEntry<S>[] {
  return entries.filter((e) => e.scope === scope);
}

/**
 * The figure entered for exactly this period, or null when none was.
 *
 * An exact range match first. The fallback only catches rows from before
 * periods were explicit, which were stored as a single date: such a row
 * counts for the period that date falls inside, preferring one it *opens*
 * over one it merely sits within, since a date names the start of its period.
 */
export function entryForPeriod<S extends string>(
  entries: LogEntry<S>[],
  scope: S,
  period: ReportPeriod,
): LogEntry<S> | null {
  const history = historyOf(entries, scope);

  const exact = history.find(
    (e) => e.periodStart === period.start && e.periodEnd === period.end,
  );
  if (exact) return exact;

  const legacy = history.filter((e) => e.periodStart === e.periodEnd);
  return (
    legacy.find((e) => e.periodStart === period.start) ??
    legacy.filter((e) => e.periodStart >= period.start && e.periodStart <= period.end).pop() ??
    null
  );
}

/**
 * The figure to show for a *level* — a running total like member count, where
 * last period's reading is still the best answer until a new one arrives.
 *
 * Falls back to the most recent earlier period's entry. A *flow* (leads added
 * during a window) must never use this: repeating it would report the same
 * leads again in every later report.
 */
export function levelForPeriod<S extends string>(
  entries: LogEntry<S>[],
  scope: S,
  period: ReportPeriod,
): LogEntry<S> | null {
  const exact = entryForPeriod(entries, scope, period);
  if (exact) return exact;
  const earlier = historyOf(entries, scope).filter((e) => e.periodStart < period.start);
  return earlier[earlier.length - 1] ?? null;
}
