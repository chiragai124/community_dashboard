/**
 * Supabase Storage as the persistence layer for this app's small JSON
 * stores (lib/imports/store.ts, lib/ai/store.ts).
 *
 * Vercel's serverless filesystem is read-only outside `/tmp`, and `/tmp` is
 * ephemeral and not shared across invocations — so writing to `data/*.json`
 * on disk (this app's original, local-dev-only persistence) fails there
 * with ENOENT on `mkdir`. This module talks to Supabase's Storage REST API
 * directly via `fetch` (no SDK dependency, matching this app's existing
 * style — see the .xlsx/.zip readers) to read and write those same JSON
 * blobs as objects in one bucket instead.
 *
 * Every object holds a JSON document, not a raw uploaded file: nothing this
 * app's users upload (a chat export, a spreadsheet) is ever stored — those
 * are still parsed in-process and discarded, exactly as before. Only the
 * small extracted-figures document that used to live at `data/imports.json`
 * (and the two AI-summary caches) now lives in Storage instead.
 */

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '') ?? '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? 'whatsapp-imports';

export function supabaseStorageEnabled(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    ...extra,
  };
}

function objectUrl(objectPath: string): string {
  return `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${objectPath}`;
}

/** Create the bucket once, if it doesn't exist yet. Private (not publicly readable). */
async function ensureBucket(): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }),
  });
  // 400/409 here means the bucket already exists — not an error worth surfacing.
  if (!res.ok && res.status !== 400 && res.status !== 409) {
    throw new Error(`Could not create Supabase Storage bucket "${BUCKET}" (${res.status}): ${await res.text()}`);
  }
}

/** Read one JSON object from Storage, or `fallback` if it doesn't exist yet. */
export async function readJsonObject<T>(objectPath: string, fallback: T): Promise<T> {
  const res = await fetch(objectUrl(objectPath), { headers: authHeaders(), cache: 'no-store' });
  if (res.status === 400 || res.status === 404) return fallback;
  if (!res.ok) {
    throw new Error(`Supabase Storage read of "${objectPath}" failed (${res.status}): ${await res.text()}`);
  }
  const text = await res.text();
  if (text.trim() === '') return fallback;
  return JSON.parse(text) as T;
}

/** Write one JSON object to Storage, creating or overwriting it (and the bucket, if needed). */
export async function writeJsonObject(objectPath: string, data: unknown): Promise<void> {
  const body = JSON.stringify(data, null, 2);
  const upload = () =>
    fetch(objectUrl(objectPath), {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json', 'x-upsert': 'true' }),
      body,
    });

  let res = await upload();
  if (!res.ok && (res.status === 400 || res.status === 404)) {
    // Most likely cause: the bucket doesn't exist yet. Create it once and retry.
    await ensureBucket();
    res = await upload();
  }
  if (!res.ok) {
    throw new Error(`Supabase Storage write of "${objectPath}" failed (${res.status}): ${await res.text()}`);
  }
}
