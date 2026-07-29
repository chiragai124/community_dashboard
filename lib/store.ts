import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { GroupSlug, WeeklyEntry, WeeklyEntryInput } from './types';
import { GROUP_SLUGS, isGroupSlug } from './groups';
import { currentWeekStart, weekStartOf, parseISODate } from './weeks';
import { demoEntries } from './demo';

/**
 * Persistence for manual weekly entries.
 *
 * Two backends, chosen at runtime:
 *   • Supabase — used when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set.
 *     Talks to the REST API directly (no client library needed). Table schema
 *     is in supabase/schema.sql.
 *   • JSON file — the default. Writes data/weekly-entries.json. Good enough for
 *     one person entering five rows a week, and it needs no setup.
 *
 * Both satisfy the same four functions below, so pages never know which is in
 * play. To add a third backend, implement those four and branch in `usingSupabase`.
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

/**
 * True when the JSON store has never been written. The dashboard seeds itself
 * with demo history in that case so it is never a wall of empty states — the UI
 * labels it as demo data.
 */
let seededWithDemo = false;

export function isShowingDemoEntries(): boolean {
  return seededWithDemo;
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

/**
 * Coerce a stored value into a clean list of short strings.
 *
 * Accepts an array (the normal case) or a single string, which is split on
 * commas and newlines — so a value hand-edited into the JSON file as
 * "Scholarships, Visa process" still loads as two items. Blank entries are
 * dropped and each item is trimmed.
 */
function toStringList(value: unknown): string[] {
  const items = Array.isArray(value)
    ? value.map((v) => String(v ?? ''))
    : typeof value === 'string'
      ? value.split(/[,\n]/)
      : [];
  return items.map((s) => s.trim()).filter((s) => s !== '');
}

/** Coerce anything that came off the wire or out of a JSON file into an entry. */
function normalizeEntry(raw: Record<string, unknown>): WeeklyEntry | null {
  const group = raw.group;
  if (!isGroupSlug(group)) return null;

  const weekStartRaw = typeof raw.weekStart === 'string' ? raw.weekStart : String(raw.week_start ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStartRaw)) return null;
  // Always snap to the Monday, so a Wednesday date can't create a second row.
  const weekStart = weekStartOf(parseISODate(weekStartRaw));

  const num = (v: unknown, fallback = 0): number => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  const overrideRaw = raw.newMembersOverride ?? raw.new_members_override;
  const newMembersOverride =
    overrideRaw === null || overrideRaw === undefined || overrideRaw === ''
      ? null
      : num(overrideRaw);

  const pollsRaw = raw.polls;
  const polls = Array.isArray(pollsRaw)
    ? pollsRaw
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
        .filter((p) => p.question !== '')
    : [];

  const activityRaw = String(raw.activityLevel ?? raw.activity_level ?? 'Medium');
  const activityLevel =
    activityRaw === 'Low' || activityRaw === 'High' || activityRaw === 'Medium'
      ? activityRaw
      : 'Medium';

  const now = new Date().toISOString();
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : makeId(group, weekStart),
    group,
    weekStart,
    totalMembers: Math.max(0, Math.round(num(raw.totalMembers ?? raw.total_members))),
    newMembersOverride,
    polls,
    dmsSent: Math.max(0, Math.round(num(raw.dmsSent ?? raw.dms_sent))),
    dmReplies: Math.max(0, Math.round(num(raw.dmReplies ?? raw.dm_replies))),
    activityLevel,
    // The four qualitative fields were added after the first entries were saved,
    // so every one of them falls back to empty. An older row stays valid.
    activityNote: String(raw.activityNote ?? raw.activity_note ?? ''),
    mainTopics: toStringList(raw.mainTopics ?? raw.main_topics),
    commonQuestions: toStringList(raw.commonQuestions ?? raw.common_questions),
    contentResponse: String(raw.contentResponse ?? raw.content_response ?? ''),
    notes: String(raw.notes ?? ''),
    createdAt: String(raw.createdAt ?? raw.created_at ?? now),
    updatedAt: String(raw.updatedAt ?? raw.updated_at ?? now),
  };
}

/* ------------------------------------------------------------- JSON backend */

/**
 * Entries that are genuinely saved on disk. Returns null when the store file
 * does not exist yet — distinct from an empty array, which means "the file is
 * there and holds nothing".
 *
 * Writes MUST build on this rather than on readJsonFile(), so demo history can
 * never be persisted and inherit the credibility of real data.
 */
async function readPersistedJson(): Promise<WeeklyEntry[] | null> {
  try {
    const text = await fs.readFile(STORE_FILE, 'utf8');
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return sortEntries(
      parsed.map((row) => normalizeEntry(row as Record<string, unknown>)).filter(
        (e): e is WeeklyEntry => e !== null,
      ),
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** What pages read: persisted entries, or demo history when nothing is saved. */
async function readJsonFile(): Promise<WeeklyEntry[]> {
  const persisted = await readPersistedJson();
  if (persisted !== null) {
    seededWithDemo = false;
    return persisted;
  }
  // Nothing saved yet — show demo history rather than five empty pages.
  seededWithDemo = true;
  return sortEntries(demoEntries());
}

async function writeJsonFile(entries: WeeklyEntry[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STORE_FILE, `${JSON.stringify(sortEntries(entries), null, 2)}\n`, 'utf8');
  seededWithDemo = false;
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
    total_members: entry.totalMembers,
    new_members_override: entry.newMembersOverride,
    polls: entry.polls,
    dms_sent: entry.dmsSent,
    dm_replies: entry.dmReplies,
    activity_level: entry.activityLevel,
    activity_note: entry.activityNote,
    main_topics: entry.mainTopics,
    common_questions: entry.commonQuestions,
    content_response: entry.contentResponse,
    notes: entry.notes,
    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
  };
}

function fromSupabaseRow(row: Record<string, unknown>): WeeklyEntry | null {
  return normalizeEntry({ ...row, group: row.group_slug });
}

async function readSupabase(): Promise<WeeklyEntry[]> {
  const url = `${SUPABASE_URL}/rest/v1/${TABLE}?select=*&order=week_start.asc`;
  const res = await fetch(url, { headers: supabaseHeaders(), cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Supabase read failed (${res.status}): ${await res.text()}`);
  }
  const rows = (await res.json()) as Record<string, unknown>[];
  seededWithDemo = false;
  return sortEntries(rows.map(fromSupabaseRow).filter((e): e is WeeklyEntry => e !== null));
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

/** Every stored entry, oldest week first. */
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
    activityLevel: input.activityLevel ?? 'Medium',
    activityNote: input.activityNote ?? '',
    mainTopics: input.mainTopics ?? [],
    commonQuestions: input.commonQuestions ?? [],
    contentResponse: input.contentResponse ?? '',
    notes: input.notes ?? '',
  } as Record<string, unknown>);

  if (!normalized) {
    throw new Error('Invalid entry: a valid group and week start (YYYY-MM-DD) are required.');
  }

  // Look the existing row up in persisted data only: matching against demo
  // history would inherit a fabricated createdAt.
  const persisted = usingSupabase() ? null : await readPersistedJson();
  const existing = usingSupabase()
    ? await getEntry(normalized.group, normalized.weekStart)
    : ((persisted ?? []).find(
        (e) => e.group === normalized.group && e.weekStart === normalized.weekStart,
      ) ?? null);

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

  // Deliberately built on persisted data, NOT on readJsonFile(): the first save
  // must not write demo history to disk. Once saved, the demo banner clears, so
  // any demo rows persisted here would read as real numbers with nothing marking
  // them as invented. Trend charts start sparse and fill in week by week —
  // truthful, and self-correcting.
  const others = (await readPersistedJson() ?? []).filter(
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
  // Persisted rows only — deleting one demo row would write the other 39 to disk.
  const current = await readPersistedJson();
  if (current === null) return false;
  const next = current.filter((e) => e.id !== id);
  if (next.length === current.length) return false;
  await writeJsonFile(next);
  return true;
}

/**
 * Values to pre-fill the weekly form with: last week's member count (so the
 * user only edits the delta) plus their usual DM volume and activity level.
 */
export async function getPrefill(
  group: GroupSlug,
  weekStart: string = currentWeekStart(),
): Promise<{
  existing: WeeklyEntry | null;
  previous: WeeklyEntry | null;
}> {
  const entries = await getEntriesForGroup(group);
  const existing = entries.find((e) => e.weekStart === weekStart) ?? null;
  const previous =
    [...entries]
      .filter((e) => e.weekStart < weekStart)
      .sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1))[0] ?? null;
  return { existing, previous };
}
