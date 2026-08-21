import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { CommunitySlug, CommunitySummary } from '../types';
import type { Takeaway } from './groq';

/**
 * Persistence for the two manually-triggered, cross-group Groq outputs:
 * one community-level topics/narrative synthesis per community, and one
 * cross-community "Headline Takeaways" set for the Overview page. Small
 * JSON files, same pattern as lib/imports/store.ts — regenerated on demand
 * via a "Regenerate" button, not automatically, since both depend on
 * multiple groups' data settling first.
 */

const DATA_DIR = path.join(process.cwd(), 'data');
const COMMUNITY_FILE = path.join(DATA_DIR, 'community-summaries.json');
const TAKEAWAYS_FILE = path.join(DATA_DIR, 'overview-takeaways.json');

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const text = await fs.readFile(file, 'utf8');
    return JSON.parse(text) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw err;
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export async function getCommunitySummaries(): Promise<Partial<Record<CommunitySlug, CommunitySummary>>> {
  return readJson(COMMUNITY_FILE, {});
}

export async function saveCommunitySummary(
  community: CommunitySlug,
  summary: CommunitySummary,
): Promise<void> {
  const all = await getCommunitySummaries();
  await writeJson(COMMUNITY_FILE, { ...all, [community]: summary });
}

export interface StoredTakeaways {
  takeaways: Takeaway[];
  generatedAt: string;
}

export async function getOverviewTakeaways(): Promise<StoredTakeaways | null> {
  return readJson<StoredTakeaways | null>(TAKEAWAYS_FILE, null);
}

export async function saveOverviewTakeaways(takeaways: Takeaway[]): Promise<void> {
  await writeJson(TAKEAWAYS_FILE, { takeaways, generatedAt: new Date().toISOString() });
}
