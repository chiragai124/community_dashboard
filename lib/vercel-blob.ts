import { get, put } from '@vercel/blob';

/**
 * Vercel Blob as the persistence layer for this app's small JSON stores
 * (lib/imports/store.ts, lib/ai/store.ts).
 *
 * Vercel's serverless filesystem is read-only outside `/tmp`, and `/tmp` is
 * ephemeral and not shared across invocations — so writing to `data/*.json`
 * on disk (this app's original, local-dev-only persistence) fails there
 * with ENOENT on `mkdir`. This module uses the `@vercel/blob` SDK's
 * `put()`/`get()` to read and write those same JSON documents as blobs
 * instead. `BLOB_READ_WRITE_TOKEN` is injected automatically once a Blob
 * store exists for the project — no manual key setup.
 *
 * (`list()` isn't needed here: `get()` already accepts a plain pathname
 * directly, which is simpler than listing by prefix and following a URL.)
 *
 * Every blob holds a JSON document, not a raw uploaded file: nothing this
 * app's users upload (a chat export, a spreadsheet) is ever stored — those
 * are still parsed in-process and discarded, exactly as before. Only the
 * small extracted-figures document that used to live at `data/imports.json`
 * (and the two AI-summary caches) now lives in Blob storage instead.
 *
 * Access level defaults to 'private' — these documents contain real names
 * and quoted message snippets (top voices, sentiment examples), so they
 * shouldn't be reachable by anyone who merely guesses or discovers the
 * blob's URL. This MUST match how the Blob store itself was created
 * (Vercel dashboard/CLI: Public or Private access) — override via
 * BLOB_STORE_ACCESS if the store is Public.
 */

const ACCESS = (process.env.BLOB_STORE_ACCESS === 'public' ? 'public' : 'private') as
  | 'public'
  | 'private';

export function vercelBlobEnabled(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/** Read one JSON blob, or `fallback` if it doesn't exist yet. */
export async function readJsonObject<T>(pathname: string, fallback: T): Promise<T> {
  // No `ifNoneMatch` is passed, so a found blob always comes back as
  // statusCode 200 (never the conditional-request 304 shape) — this check
  // is what lets TypeScript narrow `result.stream` to a real ReadableStream
  // below, not just documentation.
  const result = await get(pathname, { access: ACCESS });
  if (!result || result.statusCode !== 200) return fallback;
  const text = await new Response(result.stream).text();
  if (text.trim() === '') return fallback;
  return JSON.parse(text) as T;
}

/** Write one JSON blob, creating or overwriting it at the same pathname. */
export async function writeJsonObject(pathname: string, data: unknown): Promise<void> {
  await put(pathname, JSON.stringify(data, null, 2), {
    access: ACCESS,
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}
