import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  AiSummary,
  CommunitySlug,
  Ga4Figures,
  GroupSlug,
  ImportSource,
  ImportedFile,
  Voice,
  WhatsappFigures,
} from '../types';
import { isCommunitySlug, isGroupSlug } from '../groups';
import { parseISODate, weekStartOf } from '../weeks';
import { isValidISODate } from '../period';
import { readJsonObject, supabaseStorageEnabled, writeJsonObject } from '../supabase-storage';

/**
 * Persistence for uploaded exports: a handful of numbers per upload — not
 * the source files, and not their raw rows. Small enough to inspect or
 * hand-correct when a figure looks wrong.
 *
 * Two backends, chosen at runtime by whether SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY are set:
 *   - Supabase Storage (see ../supabase-storage.ts) — required on Vercel and
 *     any other deploy target with a read-only filesystem, since `data/` on
 *     disk isn't writable there.
 *   - A local JSON file, `data/imports.json` — the zero-config default for
 *     `npm run dev`.
 *
 * Short.io/GA4 stay on the Monday-anchored week system (untouched — see
 * lib/weeks.ts); re-uploading the same export for the same week REPLACES
 * that week's figures. WhatsApp is keyed by its manually-entered
 * periodStart/periodEnd instead — re-filing the same range REPLACES it the
 * same way. The natural key differs by source — see the `ImportedFile` doc
 * comment in ../types.ts.
 */

const DATA_DIR = path.join(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'imports.json');
const STORAGE_OBJECT = 'imports.json';

/** Short.io's natural key: it's community-scoped (currently Community #2 only). */
export function importId(
  source: ImportSource,
  community: CommunitySlug,
  weekStart: string,
): string {
  return `${source}:${community}:${weekStart}`;
}

/** WhatsApp's natural key: per-group and per manually-filed date range. */
export function importIdForPeriod(group: GroupSlug, periodStart: string, periodEnd: string): string {
  return `whatsapp:${group}:${periodStart}:${periodEnd}`;
}

/** GA4's natural key: landing-page traffic isn't scoped to a community at all. */
export function importIdForGlobal(source: ImportSource, weekStart: string): string {
  return `${source}:global:${weekStart}`;
}

function isSource(value: unknown): value is ImportSource {
  return value === 'shortio' || value === 'ga4' || value === 'whatsapp';
}

/** A number off disk, or null. Null and 0 stay distinct all the way through. */
function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function requiredNumber(value: unknown): number {
  return Math.max(0, optionalNumber(value) ?? 0);
}

/**
 * Coerce a stored row into an ImportedFile, or drop it.
 *
 * Strict about source and community: a file left over from a community that has
 * since been removed from lib/groups.ts would otherwise contribute figures no
 * page can attribute or explain.
 */
function normalizeWhatsapp(raw: unknown): WhatsappFigures | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const w = raw as Record<string, unknown>;
  const num = (v: unknown) => Math.max(0, Math.round(Number(v) || 0));
  const strList = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((s) => String(s ?? '')).filter((s) => s !== '') : [];
  const sentimentRaw = (w.sentiment ?? {}) as Record<string, unknown>;
  const examplesRaw = (sentimentRaw.examples ?? {}) as Record<string, unknown>;
  const activity = w.activityLevel;
  const topMentionsRaw = w.topTopicMentions;
  const topVoices: Voice[] = Array.isArray(w.topVoices)
    ? w.topVoices
        .map((v) => {
          const voice = v as Record<string, unknown>;
          return { name: String(voice.name ?? '').trim(), count: num(voice.count) };
        })
        .filter((v) => v.name !== '')
    : [];
  return {
    totalMembers: num(w.totalMembers),
    newMembers: Math.round(Number(w.newMembers) || 0),
    joinsViaLink: num(w.joinsViaLink),
    joinsAdded: num(w.joinsAdded),
    leaves: num(w.leaves),
    messageCount: num(w.messageCount),
    uniqueActiveChatters: num(w.uniqueActiveChatters),
    topVoices,
    activityLevel: activity === 'Low' || activity === 'High' ? activity : 'Medium',
    mainTopics: strList(w.mainTopics),
    topTopicMentions:
      topMentionsRaw === null || topMentionsRaw === undefined ? null : num(topMentionsRaw),
    sentiment: {
      positivePct: sentimentRaw.positivePct as number | null,
      neutralPct: sentimentRaw.neutralPct as number | null,
      negativePct: sentimentRaw.negativePct as number | null,
      examples: {
        positive: strList(examplesRaw.positive),
        neutral: strList(examplesRaw.neutral),
        negative: strList(examplesRaw.negative),
      },
    },
  };
}

function normalizeImport(raw: Record<string, unknown>): ImportedFile | null {
  if (!isSource(raw.source)) return null;
  // GA4 is landing-page traffic, not community data — no community to validate.
  // Everything else (Short.io, WhatsApp) still needs a real one.
  const community = isCommunitySlug(raw.community) ? raw.community : undefined;
  if (raw.source !== 'ga4' && !community) return null;
  const group = isGroupSlug(raw.group) ? raw.group : undefined;
  if (raw.source === 'whatsapp' && !group) return null;

  let weekStart: string | undefined;
  let periodStart: string | undefined;
  let periodEnd: string | undefined;

  if (raw.source === 'whatsapp') {
    // Manually entered, kept exactly as filed — not snapped to any week.
    const startRaw = String(raw.periodStart ?? '');
    const endRaw = String(raw.periodEnd ?? '');
    if (!isValidISODate(startRaw) || !isValidISODate(endRaw)) return null;
    periodStart = startRaw;
    periodEnd = endRaw;
  } else {
    const weekRaw = String(raw.weekStart ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekRaw)) return null;
    // Snap to the Monday, so a mid-week date can't create a second row.
    weekStart = weekStartOf(parseISODate(weekRaw));
  }

  const notes = Array.isArray(raw.notes)
    ? raw.notes.map((n) => String(n ?? '')).filter((n) => n !== '')
    : [];

  const shortioRaw = raw.shortio as Record<string, unknown> | undefined;
  const shortio = shortioRaw
    ? {
        totalClicks: requiredNumber(shortioRaw.totalClicks),
        links: Array.isArray(shortioRaw.links)
          ? shortioRaw.links
              .map((l) => {
                const link = l as Record<string, unknown>;
                return {
                  path: String(link.path ?? '').trim(),
                  clicks: requiredNumber(link.clicks),
                };
              })
              .filter((l) => l.path !== '')
          : [],
      }
    : undefined;

  const ga4Raw = raw.ga4 as Record<string, unknown> | undefined;
  const ga4 = ga4Raw
    ? {
        activeUsers: optionalNumber(ga4Raw.activeUsers),
        newUsers: optionalNumber(ga4Raw.newUsers),
        sessions: optionalNumber(ga4Raw.sessions),
      }
    : undefined;

  const whatsapp = raw.source === 'whatsapp' ? normalizeWhatsapp(raw.whatsapp) : undefined;
  const aiSummaryRaw = raw.aiSummary as Record<string, unknown> | undefined;
  const aiSummary: AiSummary | undefined =
    raw.source === 'whatsapp' && aiSummaryRaw
      ? {
          statusTag: String(aiSummaryRaw.statusTag ?? ''),
          topVoicesSummary: String(aiSummaryRaw.topVoicesSummary ?? ''),
          narrative: String(aiSummaryRaw.narrative ?? ''),
          generatedAt: String(aiSummaryRaw.generatedAt ?? new Date().toISOString()),
        }
      : undefined;

  return {
    id:
      typeof raw.id === 'string' && raw.id
        ? raw.id
        : raw.source === 'whatsapp' && group && periodStart && periodEnd
          ? importIdForPeriod(group, periodStart, periodEnd)
          : raw.source === 'ga4'
            ? importIdForGlobal(raw.source, weekStart!)
            : importId(raw.source, community!, weekStart!),
    source: raw.source,
    community,
    group,
    weekStart,
    periodStart,
    periodEnd,
    filename: String(raw.filename ?? 'upload'),
    uploadedAt: String(raw.uploadedAt ?? new Date().toISOString()),
    notes,
    shortio,
    ga4,
    whatsapp,
    aiSummary,
  };
}

/** Newest upload first, so "the latest file" is always index 0. */
function sortImports(files: ImportedFile[]): ImportedFile[] {
  return [...files].sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));
}

/* ----------------------------------------------------------------- reading */

/**
 * Everything uploaded so far. A missing store (file or Storage object) is an
 * empty list, not an error: nothing imported yet is the normal starting
 * state.
 */
export async function getImports(): Promise<ImportedFile[]> {
  const raw = supabaseStorageEnabled()
    ? await readJsonObject<unknown>(STORAGE_OBJECT, [])
    : await readLocalFile();
  const parsed = raw;
  if (!Array.isArray(parsed)) return [];
  return sortImports(
    parsed
      .map((row) => normalizeImport(row as Record<string, unknown>))
      .filter((f): f is ImportedFile => f !== null),
  );
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

/* ----------------------------------------------------------------- writing */

async function writeImports(files: ImportedFile[]): Promise<void> {
  const sorted = sortImports(files);
  if (supabaseStorageEnabled()) {
    await writeJsonObject(STORAGE_OBJECT, sorted);
    return;
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STORE_FILE, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
}

function withId(file: Omit<ImportedFile, 'id' | 'uploadedAt'>): ImportedFile {
  const id =
    file.source === 'whatsapp' && file.group && file.periodStart && file.periodEnd
      ? importIdForPeriod(file.group, file.periodStart, file.periodEnd)
      : file.source === 'ga4'
        ? importIdForGlobal(file.source, file.weekStart!)
        : importId(file.source, file.community!, file.weekStart!);
  return {
    ...file,
    id,
    uploadedAt: new Date().toISOString(),
  };
}

/** Store one upload, replacing any previous file sharing its natural key. */
export async function saveImport(
  file: Omit<ImportedFile, 'id' | 'uploadedAt'>,
): Promise<ImportedFile> {
  const [stored] = await saveImports([file]);
  return stored;
}

/**
 * Store many uploads in one read-modify-write, replacing any previous file
 * sharing an id with an incoming one. Saving one at a time via repeated
 * `saveImport` calls — even sequentially — still means one read+write per
 * row, and calling them concurrently (e.g. `Promise.all`) races on the same
 * JSON file and can corrupt it, since each call reads-then-writes the whole
 * file independently. This reads once and writes once for the whole batch.
 */
export async function saveImports(
  files: Omit<ImportedFile, 'id' | 'uploadedAt'>[],
): Promise<ImportedFile[]> {
  const stored = files.map(withId);
  const incomingIds = new Set(stored.map((f) => f.id));
  const others = (await getImports()).filter((f) => !incomingIds.has(f.id));
  await writeImports([...others, ...stored]);
  return stored;
}

/** Remove one upload. False when the id wasn't there. */
export async function deleteImport(id: string): Promise<boolean> {
  const current = await getImports();
  const next = current.filter((f) => f.id !== id);
  if (next.length === current.length) return false;
  await writeImports(next);
  return true;
}

/** Unconditionally wipe every uploaded file's figures — Short.io, GA4 and WhatsApp alike. */
export async function resetImports(): Promise<{ count: number }> {
  const current = await getImports();
  await writeImports([]);
  return { count: current.length };
}

/* ---------------------------------------------------------------- selectors */

/** The stored file for one source, community and week, if any. */
export function findImport(
  files: ImportedFile[],
  source: ImportSource,
  community: CommunitySlug,
  weekStart: string,
): ImportedFile | null {
  return (
    files.find(
      (f) => f.source === source && f.community === community && f.weekStart === weekStart,
    ) ?? null
  );
}

/** Every filed period for one group, oldest first. */
export function groupPeriods(files: ImportedFile[], group: GroupSlug): ImportedFile[] {
  return files
    .filter((f) => f.source === 'whatsapp' && f.group === group && f.periodStart)
    .sort((a, b) => (a.periodStart! < b.periodStart! ? -1 : 1));
}

/** This group's most recently filed period, or null if none has ever been filed. */
export function latestGroupPeriod(files: ImportedFile[], group: GroupSlug): ImportedFile | null {
  const periods = groupPeriods(files, group);
  return periods[periods.length - 1] ?? null;
}

/**
 * The period immediately before `beforeStart` for this group, if any —
 * what a newly-filed period's activity level and member comparison are
 * measured against. Ordered by periodStart, not upload time, so re-filing
 * an old period out of order still compares against the right neighbour.
 */
export function previousGroupPeriod(
  files: ImportedFile[],
  group: GroupSlug,
  beforeStart: string,
): ImportedFile | null {
  const earlier = groupPeriods(files, group).filter((f) => f.periodStart! < beforeStart);
  return earlier[earlier.length - 1] ?? null;
}

/**
 * Community #2's Short.io figures for one week, or null when nothing's been
 * uploaded for it — never zero, so "not imported yet" stays distinguishable
 * from "genuinely no clicks". Still community-parameterized (rather than
 * hardcoded to community-2) so a second community could pick up Short.io
 * later without a signature change, but only Community #2 declares the
 * capability today — see lib/groups.ts.
 */
export function shortioWeek(
  files: ImportedFile[],
  community: CommunitySlug,
  weekStart: string,
) {
  return findImport(files, 'shortio', community, weekStart)?.shortio ?? null;
}

/** The stored GA4 file for one week, if any — landing-page traffic, no community. */
export function findGa4Import(files: ImportedFile[], weekStart: string): ImportedFile | null {
  return files.find((f) => f.source === 'ga4' && f.weekStart === weekStart) ?? null;
}

/** Landing-page GA4 figures for one week, or null when nothing's been uploaded for it. */
export function ga4Week(files: ImportedFile[], weekStart: string): Ga4Figures | null {
  return findGa4Import(files, weekStart)?.ga4 ?? null;
}
