import { promises as fs } from 'node:fs';
import path from 'node:path';
import { isValidISODate } from './period';
import { readJsonObject, vercelBlobEnabled, writeJsonObject } from './vercel-blob';
import { createEntryLog, entryForPeriod, levelForPeriod, type LogEntry } from './entry-log';
import type { ReportPeriod } from './reports';

/**
 * The Instagram broadcast channel: when it was created, and how many members
 * it has.
 *
 * Two different kinds of fact, so two different stores. The creation date is
 * a single standing value — entered once, edited only to correct it — and is
 * what the report's "running for N weeks" line is computed from. The member
 * count is a reading taken each report, so it goes in the same append-only
 * dated log every other manual figure uses (lib/entry-log.ts), which is what
 * makes "vs. last report" answerable without anyone re-typing last report's
 * number.
 *
 * There is one channel, not one per community, so the log has a single fixed
 * scope rather than a community slug.
 */

const DATA_DIR = path.join(process.cwd(), 'data');
const SETTINGS_FILE = 'instagram-channel.json';
const SETTINGS_PATH = path.join(DATA_DIR, SETTINGS_FILE);

/** The one series in the member-count log. */
export const INSTAGRAM_SCOPE = 'broadcast' as const;
export type InstagramScope = typeof INSTAGRAM_SCOPE;
export type InstagramMemberEntry = LogEntry<InstagramScope>;

function isInstagramScope(value: unknown): value is InstagramScope {
  return value === INSTAGRAM_SCOPE;
}

const log = createEntryLog<InstagramScope>({
  fileName: 'instagram-members.json',
  isScope: isInstagramScope,
});

/* ------------------------------------------------------------- the channel */

export interface InstagramChannel {
  /** The date the channel was created, or null if it hasn't been entered yet. */
  createdOn: string | null;
}

async function readLocalSettings(): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(SETTINGS_PATH, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function getInstagramChannel(): Promise<InstagramChannel> {
  const raw = vercelBlobEnabled()
    ? await readJsonObject<unknown>(SETTINGS_FILE, null)
    : await readLocalSettings();
  if (!raw || typeof raw !== 'object') return { createdOn: null };
  const createdOn = String((raw as Record<string, unknown>).createdOn ?? '');
  return { createdOn: isValidISODate(createdOn) ? createdOn : null };
}

/** Set (or correct) the channel's creation date. */
export async function saveInstagramChannel(createdOn: string): Promise<InstagramChannel> {
  const channel: InstagramChannel = { createdOn };
  if (vercelBlobEnabled()) {
    await writeJsonObject(SETTINGS_FILE, channel);
    return channel;
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(SETTINGS_PATH, `${JSON.stringify(channel, null, 2)}\n`, 'utf8');
  return channel;
}

/* -------------------------------------------------------- the member count */

/** Every member-count reading, oldest first. */
export const getInstagramMemberEntries = log.getEntries;

/** Record the channel's member count for a report period. */
export function saveInstagramMemberEntry(
  members: number,
  period: ReportPeriod,
): Promise<InstagramMemberEntry> {
  return log.saveEntry(INSTAGRAM_SCOPE, members, period);
}

/** The count entered for exactly this period, or null — what the form pre-fills with. */
export function instagramMembersEnteredFor(
  entries: InstagramMemberEntry[],
  period: ReportPeriod,
): InstagramMemberEntry | null {
  return entryForPeriod(entries, INSTAGRAM_SCOPE, period);
}

/**
 * The count this period reports. A level like the community member totals, so
 * an earlier reading carries forward until a newer one is entered.
 */
export function instagramMembersFor(
  entries: InstagramMemberEntry[],
  period: ReportPeriod,
): InstagramMemberEntry | null {
  return levelForPeriod(entries, INSTAGRAM_SCOPE, period);
}

/**
 * Whole weeks between the channel's creation and `asOf` — the "running for N
 * weeks" line. Null when no creation date has been entered, so the report can
 * leave the line out rather than claim the channel is zero weeks old.
 */
export function weeksSinceCreated(createdOn: string | null, asOf: string): number | null {
  if (!createdOn) return null;
  const from = new Date(`${createdOn}T00:00:00.000Z`).getTime();
  const to = new Date(`${asOf}T00:00:00.000Z`).getTime();
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return null;
  return Math.floor((to - from) / (7 * 24 * 60 * 60 * 1000));
}
