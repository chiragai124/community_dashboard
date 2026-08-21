import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { CommunitySlug, CommunitySummary } from '../types';
import type { Takeaway } from './groq';
import { readJsonObject, supabaseStorageEnabled, writeJsonObject } from '../supabase-storage';

/**
 * Persistence for the two manually-triggered, cross-group Groq outputs:
 * one community-level topics/narrative synthesis per community, and one
 * cross-community "Headline Takeaways" set for the Overview page.
 * Regenerated on demand via a "Regenerate" button, not automatically, since
 * both depend on multiple groups' data settling first.
 *
 * Same dual-backend pattern as lib/imports/store.ts: Supabase Storage when
 * SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set (required on Vercel,
 * whose filesystem is read-only outside `/tmp`), a local JSON file
 * otherwise (the zero-config default for `npm run dev`).
 */

const DATA_DIR = path.join(process.cwd(), 'data');
const COMMUNITY_FILE = path.join(DATA_DIR, 'community-summaries.json');
const TAKEAWAYS_FILE = path.join(DATA_DIR, 'overview-takeaways.json');
const COMMUNITY_OBJECT = 'community-summaries.json';
const TAKEAWAYS_OBJECT = 'overview-takeaways.json';

async function readLocalJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const text = await fs.readFile(file, 'utf8');
    return JSON.parse(text) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw err;
  }
}

async function writeLocalJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function readJson<T>(objectName: string, file: string, fallback: T): Promise<T> {
  return supabaseStorageEnabled()
    ? readJsonObject(objectName, fallback)
    : readLocalJson(file, fallback);
}

async function writeJson(objectName: string, file: string, data: unknown): Promise<void> {
  if (supabaseStorageEnabled()) {
    await writeJsonObject(objectName, data);
    return;
  }
  await writeLocalJson(file, data);
}

export async function getCommunitySummaries(): Promise<Partial<Record<CommunitySlug, CommunitySummary>>> {
  return readJson(COMMUNITY_OBJECT, COMMUNITY_FILE, {});
}

export async function saveCommunitySummary(
  community: CommunitySlug,
  summary: CommunitySummary,
): Promise<void> {
  const all = await getCommunitySummaries();
  await writeJson(COMMUNITY_OBJECT, COMMUNITY_FILE, { ...all, [community]: summary });
}

export interface StoredTakeaways {
  takeaways: Takeaway[];
  generatedAt: string;
}

export async function getOverviewTakeaways(): Promise<StoredTakeaways | null> {
  return readJson<StoredTakeaways | null>(TAKEAWAYS_OBJECT, TAKEAWAYS_FILE, null);
}

export async function saveOverviewTakeaways(takeaways: Takeaway[]): Promise<void> {
  await writeJson(TAKEAWAYS_OBJECT, TAKEAWAYS_FILE, {
    takeaways,
    generatedAt: new Date().toISOString(),
  });
}
