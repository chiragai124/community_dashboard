import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { GroupSlug, Poll, WeeklyEntry, WeeklyEntryInput } from './types';
import { GROUP_SLUGS, isGroupSlug } from './groups';
import { currentWeekStart, weekStartOf, parseISODate } from './weeks';

/**
 * Persistence for the only hand-typed data left: poll counts and DM figures.
 *
 * Everything else the dashboard shows is computed from an uploaded export. These
 * three survive because no export contains them — WhatsApp exports carry a poll's
 * question but never its votes, and a group export contains no 1:1 threads.
 *
 * Two backends, chosen at runtime:
 *   • Supabase — used when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set.
 *   • JSON file — the default, at data/weekly-entries.json. No setup.
 *
 * THERE IS NO DEMO MODE. It was removed with the manual member counts: member
 * figures now come from the chat export, so seeded entries could not have
 * produced a coherent dashboard anyway — and a fabricated number that outlives
 * the moment it was useful costs more than an empty state does.
 */

const DATA_DIR = path.join(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'weekly-entries.json');
const TABLE = 'weekly_entries';

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '') ?? '';
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';

export function usingSupabase(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

export function storeBackendLabel(): string {
  return usingSupabase() ? 'Supabase' : 'JSON file (data/weekly-entries.json)';
}

/* ------------------------------------------------------------------ helpers */

function makeId(group: GroupSlug, weekStart: string): string {
  return `${group}:${weekStart}`;
}

function sortEntries(entries: WeeklyEntry[]): WeeklyEntry[] {
  return [...entries].sort((a, b) => {
    if (a.weekStart !== b.weekStart) return a.weekStart < b.weekStart ? -1 : 1;
    return GROUP_SLUGS.indexOf(a.group) - GROUP_SLUGS.indexOf(b.group);
  });
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

function normalizePolls(raw: unknown): Poll[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p) => {
      const poll = p as Record<string, unknown>;
      const options = Array.isArray(poll.options)
        ? poll.options
            .map((o) => {
              const opt = o as Record<string, unknown>;
              return { label: String(opt.label ?? '').trim(), count: num(opt.count) };
            })
            .filter((o) => o.label !== '')
        : [];
      return { question: String(poll.question ?? '').trim(), options };
    })
    .filter((p) => p.question !== '');
}

/** Coerce anything off the wire or out of the JSON file into an entry. */
function normalizeEntry(raw: Record<string, unknown>): WeeklyEntry | null {
  const group = raw.group;
  if (!isGroupSlug(group)) return null;

  const weekRaw =
    typeof raw.weekStart === 'string' ? raw.weekStart : String(raw.week_start ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekRaw)) return null;
  // Always snap to the Monday, so a Wednesday date can't create a second row.
  const weekStart = weekStartOf(parseISODate(weekRaw));

  const now = new Date().toISOString();
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : makeId(group, weekStart),
    group,
    weekStart,
    polls: normalizePolls(raw.polls),
    dmsSent: num(raw.dmsSent ?? raw.dms_sent),
    dmReplies: num(raw.dmReplies ?? raw.dm_replies),
    createdAt: String(raw.createdAt ?? raw.created_at ?? now),
    updatedAt: String(raw.updatedAt ?? raw.updated_at ?? now),
  };
}

/* ------------------------------------------------------------- JSON backend */

async function readJsonFile(): Promise<WeeklyEntry[]> {
  try {
    const text = await fs.readFile(STORE_FILE, 'utf8');
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return sortEntries(
      parsed
        .map((row) => normalizeEntry(row as Record<string, unknown>))
        .filter((e): e is WeeklyEntry => e !== null),
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

async function writeJsonFile(entries: WeeklyEntry[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STORE_FILE, `${JSON.stringify(sortEntries(entries), null, 2)}\n`, 'utf8');
}

/* --------------------------------------------------------- Supabase backend */

function supabaseHeaders(): Record<string, string> {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  };
}

function toSupabaseRow(entry: WeeklyEntry): Record<string, unknown> {
  return {
    id: entry.id,
    group_slug: entry.group,
    week_start: entry.weekStart,
    polls: entry.polls,
    dms_sent: entry.dmsSent,
    dm_replies: entry.dmReplies,
    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
  };
}

async function readSupabase(): Promise<WeeklyEntry[]> {
  const url = `${SUPABASE_URL}/rest/v1/${TABLE}?select=*&order=week_start.asc`;
  const res = await fetch(url, { headers: supabaseHeaders(), cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Supabase read failed (${res.status}): ${await res.text()}`);
  }
  const rows = (await res.json()) as Record<string, unknown>[];
  return sortEntries(
    rows
      .map((row) => normalizeEntry({ ...row, group: row.group_slug }))
      .filter((e): e is WeeklyEntry => e !== null),
  );
}

async function upsertSupabase(entry: WeeklyEntry): Promise<void> {
  const url = `${SUPABASE_URL}/rest/v1/${TABLE}?on_conflict=group_slug,week_start`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...supabaseHeaders(), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([toSupabaseRow(entry)]),
  });
  if (!res.ok) {
    throw new Error(`Supabase upsert failed (${res.status}): ${await res.text()}`);
  }
}

async function deleteSupabase(id: string): Promise<void> {
  const url = `${SUPABASE_URL}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(id)}`;
  const res = await fetch(url, { method: 'DELETE', headers: supabaseHeaders() });
  if (!res.ok) {
    throw new Error(`Supabase delete failed (${res.status}): ${await res.text()}`);
  }
}

/* --------------------------------------------------------------- public API */

export async function getEntries(): Promise<WeeklyEntry[]> {
  return usingSupabase() ? readSupabase() : readJsonFile();
}

export async function getEntriesForGroup(group: GroupSlug): Promise<WeeklyEntry[]> {
  return (await getEntries()).filter((e) => e.group === group);
}

export async function getEntry(
  group: GroupSlug,
  weekStart: string,
): Promise<WeeklyEntry | null> {
  const entries = await getEntries();
  return entries.find((e) => e.group === group && e.weekStart === weekStart) ?? null;
}

/**
 * Insert or update one group-week. `group` + `weekStart` is the natural key, so
 * re-submitting the same week edits it rather than creating a duplicate.
 */
export async function saveEntry(input: WeeklyEntryInput): Promise<WeeklyEntry> {
  const normalized = normalizeEntry({
    ...input,
    polls: input.polls ?? [],
  } as Record<string, unknown>);

  if (!normalized) {
    throw new Error('Invalid entry: a valid group and week start (YYYY-MM-DD) are required.');
  }

  const existing = await getEntry(normalized.group, normalized.weekStart);
  const now = new Date().toISOString();
  const entry: WeeklyEntry = {
    ...normalized,
    id: existing?.id ?? makeId(normalized.group, normalized.weekStart),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  if (usingSupabase()) {
    await upsertSupabase(entry);
    return entry;
  }

  const others = (await readJsonFile()).filter(
    (e) => !(e.group === entry.group && e.weekStart === entry.weekStart),
  );
  await writeJsonFile([...others, entry]);
  return entry;
}

export async function deleteEntry(id: string): Promise<boolean> {
  if (usingSupabase()) {
    await deleteSupabase(id);
    return true;
  }
  const current = await readJsonFile();
  const next = current.filter((e) => e.id !== id);
  if (next.length === current.length) return false;
  await writeJsonFile(next);
  return true;
}

/** Weeks offered in the form: this week plus the previous 7, newest first. */
export function entryWeeks(count = 8): string[] {
  const weeks: string[] = [];
  const current = currentWeekStart();
  for (let i = 0; i < count; i += 1) {
    weeks.push(weekStartOf(new Date(parseISODate(current).getTime() - i * 7 * 86400000)));
  }
  return weeks;
}
