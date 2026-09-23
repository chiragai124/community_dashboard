import { promises as fs } from 'node:fs';
import path from 'node:path';
import { isValidISODate } from './period';
import { readJsonObject, vercelBlobEnabled, writeJsonObject } from './vercel-blob';

/**
 * A dated, append-only log of hand-entered numbers — the shape shared by
 * every manual figure in this dashboard that isn't derivable from an export:
 * leads added to the CRM, the Instagram broadcast channel's member count,
 * and (historically) community member totals.
 *
 * Append-only matters for the report history. Each entry carries the date it
 * is true *as of*, so a report for any past date range can ask "what was this
 * number at the end of that period" and get the answer that was current then
 * — rather than whatever the latest entry happens to say now. That is what
 * makes previously-filed reports stable instead of silently rewriting
 * themselves every time a new number is entered (see lib/reports.ts).
 *
 * Same dual-backend pattern as lib/imports/store.ts: Vercel Blob when
 * BLOB_READ_WRITE_TOKEN is set (required on Vercel, whose filesystem is
 * read-only outside `/tmp`), a local JSON file otherwise — the zero-config
 * default for `npm run dev`.
 *
 * lib/community-members.ts predates this module and keeps its own
 * `{ community, total }` field names, because its stored JSON is already on
 * disk for real users and renaming fields would silently drop their history.
 * It is the same idea with different spelling.
 */

const DATA_DIR = path.join(process.cwd(), 'data');

/** One hand-entered reading of one number, as of a chosen date. */
export interface LogEntry<Scope extends string = string> {
  /** Which series this belongs to — a community slug, or a fixed key for a single-series log. */
  scope: Scope;
  value: number;
  /** The date this reading is true as of — chosen by the person, defaults to today. */
  enteredAt: string;
  /** When it was actually saved, for "entered 2 days ago" display. */
  recordedAt: string;
}

export interface EntryLog<Scope extends string> {
  /** Every entry, every scope, oldest first. */
  getEntries(): Promise<LogEntry<Scope>[]>;
  /**
   * Record one reading. Re-saving the same scope + date replaces that entry
   * (correcting a typo) rather than creating a duplicate; any other date is
   * added as a new point in the history.
   */
  saveEntry(scope: Scope, value: number, enteredAt: string): Promise<LogEntry<Scope>>;
}

function sortEntries<S extends string>(entries: LogEntry<S>[]): LogEntry<S>[] {
  return [...entries].sort((a, b) =>
    a.enteredAt < b.enteredAt ? -1 : a.enteredAt > b.enteredAt ? 1 : 0,
  );
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

  function normalize(raw: unknown): LogEntry<Scope> | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    if (!isScope(r.scope)) return null;
    const enteredAt = String(r.enteredAt ?? '');
    if (!isValidISODate(enteredAt)) return null;
    return {
      scope: r.scope,
      value: Math.max(0, Math.round(Number(r.value) || 0)),
      enteredAt,
      recordedAt: String(r.recordedAt ?? new Date().toISOString()),
    };
  }

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
    return sortEntries(raw.map(normalize).filter((e): e is LogEntry<Scope> => e !== null));
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
    enteredAt: string,
  ): Promise<LogEntry<Scope>> {
    const entry: LogEntry<Scope> = {
      scope,
      value: Math.max(0, Math.round(value)),
      enteredAt,
      recordedAt: new Date().toISOString(),
    };
    const current = await getEntries();
    const others = current.filter((e) => !(e.scope === scope && e.enteredAt === enteredAt));
    await write([...others, entry]);
    return entry;
  }

  return { getEntries, saveEntry };
}

/* ---------------------------------------------------------------- selectors */

/** One scope's history, oldest first. */
export function historyOf<S extends string>(entries: LogEntry<S>[], scope: S): LogEntry<S>[] {
  return entries.filter((e) => e.scope === scope);
}

/**
 * The reading that was current at the end of `asOf` — the latest entry dated
 * on or before it, or null when nothing had been entered yet by then.
 *
 * This, not "the most recent entry", is what a report for a past date range
 * must use: a report filed for August shouldn't silently adopt September's
 * member count the moment it's typed in.
 */
export function entryAsOf<S extends string>(
  entries: LogEntry<S>[],
  scope: S,
  asOf: string,
): LogEntry<S> | null {
  const eligible = historyOf(entries, scope).filter((e) => e.enteredAt <= asOf);
  return eligible[eligible.length - 1] ?? null;
}

/** The reading current at the end of `asOf`, excluding anything from `notBefore` onward. */
export function entryBefore<S extends string>(
  entries: LogEntry<S>[],
  scope: S,
  before: string,
): LogEntry<S> | null {
  const eligible = historyOf(entries, scope).filter((e) => e.enteredAt < before);
  return eligible[eligible.length - 1] ?? null;
}
