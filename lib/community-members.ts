import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { CommunityMemberEntry, CommunitySlug } from './types';
import { isCommunitySlug } from './groups';
import { isValidISODate } from './period';
import { readJsonObject, vercelBlobEnabled, writeJsonObject } from './vercel-blob';

/**
 * Manual "Total Members" entries, one append-only history per community.
 *
 * WhatsApp exports don't reliably contain a group's full join/leave history
 * (older events can be missing depending on export settings and app
 * version), so a replay-based member total silently undercounts — see the
 * module doc in lib/imports/whatsapp.ts. Total membership is tracked here
 * instead: a person enters a total for a community as of a chosen date, and
 * every entry is kept (never overwritten in place, except when re-saving the
 * same community+date to correct a mistake), so "vs. last entry" is always
 * answerable.
 *
 * Same dual-backend pattern as lib/imports/store.ts and lib/ai/store.ts:
 * Vercel Blob when BLOB_READ_WRITE_TOKEN is set (required on Vercel), a
 * local JSON file otherwise (the zero-config default for `npm run dev`).
 */

const DATA_DIR = path.join(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'community-members.json');
const STORAGE_OBJECT = 'community-members.json';

function normalizeEntry(raw: unknown): CommunityMemberEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isCommunitySlug(r.community)) return null;
  const total = Math.max(0, Math.round(Number(r.total) || 0));
  const enteredAt = String(r.enteredAt ?? '');
  if (!isValidISODate(enteredAt)) return null;
  return {
    community: r.community,
    total,
    enteredAt,
    recordedAt: String(r.recordedAt ?? new Date().toISOString()),
  };
}

function sortEntries(entries: CommunityMemberEntry[]): CommunityMemberEntry[] {
  return [...entries].sort((a, b) => (a.enteredAt < b.enteredAt ? -1 : a.enteredAt > b.enteredAt ? 1 : 0));
}

async function readLocalFile(): Promise<unknown> {
  try {
    const text = await fs.readFile(STORE_FILE, 'utf8');
    return JSON.parse(text);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

async function writeEntries(entries: CommunityMemberEntry[]): Promise<void> {
  const sorted = sortEntries(entries);
  if (vercelBlobEnabled()) {
    await writeJsonObject(STORAGE_OBJECT, sorted);
    return;
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STORE_FILE, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
}

/** Every entry, every community, oldest first. */
export async function getCommunityMemberEntries(): Promise<CommunityMemberEntry[]> {
  const raw = vercelBlobEnabled()
    ? await readJsonObject<unknown>(STORAGE_OBJECT, [])
    : await readLocalFile();
  if (!Array.isArray(raw)) return [];
  return sortEntries(raw.map(normalizeEntry).filter((e): e is CommunityMemberEntry => e !== null));
}

/**
 * Record one community's total as of `enteredAt` (defaults to today).
 * Re-saving the same community + date replaces that entry (correcting a
 * mistake) rather than creating a duplicate; any other date is added as a
 * new point in the history.
 */
export async function saveCommunityMemberEntry(
  community: CommunitySlug,
  total: number,
  enteredAt: string,
): Promise<CommunityMemberEntry> {
  const entry: CommunityMemberEntry = {
    community,
    total: Math.max(0, Math.round(total)),
    enteredAt,
    recordedAt: new Date().toISOString(),
  };
  const current = await getCommunityMemberEntries();
  const others = current.filter((e) => !(e.community === community && e.enteredAt === enteredAt));
  await writeEntries([...others, entry]);
  return entry;
}

/** One community's history, oldest first. */
export function communityMemberHistory(
  entries: CommunityMemberEntry[],
  community: CommunitySlug,
): CommunityMemberEntry[] {
  return entries.filter((e) => e.community === community);
}

/** The most recent entry for a community, or null if none has ever been saved. */
export function latestCommunityMemberEntry(
  entries: CommunityMemberEntry[],
  community: CommunitySlug,
): CommunityMemberEntry | null {
  const history = communityMemberHistory(entries, community);
  return history[history.length - 1] ?? null;
}

/** The entry immediately before the latest one for a community, or null if there's only one (or none). */
export function previousCommunityMemberEntry(
  entries: CommunityMemberEntry[],
  community: CommunitySlug,
): CommunityMemberEntry | null {
  const history = communityMemberHistory(entries, community);
  return history[history.length - 2] ?? null;
}
