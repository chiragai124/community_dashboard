import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  CommunitySlug,
  ImportSource,
  ImportedFile,
  ImportedWeek,
} from '../types';
import { isCommunitySlug } from '../groups';
import { parseISODate, weekStartOf } from '../weeks';

/**
 * Persistence for uploaded exports.
 *
 * One JSON file, data/imports.json, holding a handful of numbers per upload —
 * not the source files, and not their raw rows. Two uploads a week per community
 * does not need a database, and a small readable file can be inspected or
 * hand-corrected when a figure looks wrong.
 *
 * `source` + `community` + `weekStart` is the natural key. Re-uploading the same
 * export for the same week REPLACES that week's figures rather than adding to
 * them, which is what makes the weekly routine safe: upload the same file twice
 * and nothing doubles.
 */

const DATA_DIR = path.join(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'imports.json');

export function importId(
  source: ImportSource,
  community: CommunitySlug,
  weekStart: string,
): string {
  return `${source}:${community}:${weekStart}`;
}

function isSource(value: unknown): value is ImportSource {
  return value === 'shortio' || value === 'ga4';
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
function normalizeImport(raw: Record<string, unknown>): ImportedFile | null {
  if (!isSource(raw.source)) return null;
  if (!isCommunitySlug(raw.community)) return null;

  const weekRaw = String(raw.weekStart ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekRaw)) return null;
  // Snap to the Monday, so a mid-week date can't create a second row.
  const weekStart = weekStartOf(parseISODate(weekRaw));

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

  return {
    id:
      typeof raw.id === 'string' && raw.id
        ? raw.id
        : importId(raw.source, raw.community, weekStart),
    source: raw.source,
    community: raw.community,
    weekStart,
    filename: String(raw.filename ?? 'upload'),
    uploadedAt: String(raw.uploadedAt ?? new Date().toISOString()),
    notes,
    shortio,
    ga4,
  };
}

/** Newest upload first, so "the latest file" is always index 0. */
function sortImports(files: ImportedFile[]): ImportedFile[] {
  return [...files].sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));
}

/* ----------------------------------------------------------------- reading */

/**
 * Everything uploaded so far. A missing store file is an empty list, not an
 * error: nothing imported yet is the normal starting state.
 */
export async function getImports(): Promise<ImportedFile[]> {
  try {
    const text = await fs.readFile(STORE_FILE, 'utf8');
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return sortImports(
      parsed
        .map((row) => normalizeImport(row as Record<string, unknown>))
        .filter((f): f is ImportedFile => f !== null),
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

/* ----------------------------------------------------------------- writing */

async function writeImports(files: ImportedFile[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STORE_FILE, `${JSON.stringify(sortImports(files), null, 2)}\n`, 'utf8');
}

/** Store one upload, replacing any previous file for the same source and week. */
export async function saveImport(
  file: Omit<ImportedFile, 'id' | 'uploadedAt'>,
): Promise<ImportedFile> {
  const stored: ImportedFile = {
    ...file,
    id: importId(file.source, file.community, file.weekStart),
    uploadedAt: new Date().toISOString(),
  };
  const others = (await getImports()).filter((f) => f.id !== stored.id);
  await writeImports([...others, stored]);
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

/**
 * The figures for one community and week. Null per source when nothing has been
 * uploaded for it — never zero, so "not imported yet" stays distinguishable from
 * "genuinely no clicks".
 */
export function importedWeek(
  files: ImportedFile[],
  community: CommunitySlug,
  weekStart: string,
): ImportedWeek {
  return {
    weekStart,
    shortio: findImport(files, 'shortio', community, weekStart)?.shortio ?? null,
    ga4: findImport(files, 'ga4', community, weekStart)?.ga4 ?? null,
  };
}

/**
 * The same figures pooled over several communities — what the merged view shows.
 *
 * A source stays null unless at least one community in scope has it, and sums
 * only over those that do. Link paths with the same name in two communities are
 * added together, since the path is the identity of the link.
 */
export function mergedWeek(
  files: ImportedFile[],
  communities: CommunitySlug[],
  weekStart: string,
): ImportedWeek {
  const weeks = communities.map((c) => importedWeek(files, c, weekStart));

  const shortioWeeks = weeks.map((w) => w.shortio).filter((s) => s !== null);
  const ga4Weeks = weeks.map((w) => w.ga4).filter((g) => g !== null);

  const byPath = new Map<string, number>();
  for (const week of shortioWeeks) {
    for (const link of week.links) {
      byPath.set(link.path, (byPath.get(link.path) ?? 0) + link.clicks);
    }
  }

  /** Sum a GA4 metric across communities, staying null if none reported it. */
  const sum = (pick: (g: NonNullable<ImportedWeek['ga4']>) => number | null): number | null => {
    const values = ga4Weeks.map(pick).filter((v): v is number => v !== null);
    return values.length === 0 ? null : values.reduce((s, v) => s + v, 0);
  };

  return {
    weekStart,
    shortio:
      shortioWeeks.length === 0
        ? null
        : {
            totalClicks: shortioWeeks.reduce((s, w) => s + w.totalClicks, 0),
            links: [...byPath.entries()]
              .map(([path, clicks]) => ({ path, clicks }))
              .sort((a, b) => b.clicks - a.clicks),
          },
    ga4:
      ga4Weeks.length === 0
        ? null
        : {
            activeUsers: sum((g) => g.activeUsers),
            newUsers: sum((g) => g.newUsers),
            sessions: sum((g) => g.sessions),
          },
  };
}
