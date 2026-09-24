'use client';

import { upload } from '@vercel/blob/client';

/**
 * Sending a WhatsApp chat export to /api/imports without putting it through
 * a serverless request body.
 *
 * A "with media" export is tens of megabytes, and a serverless platform caps
 * the request body far below that — Vercel at a few MB, counted across the
 * whole multipart body, which is why five exports at once were rejected where
 * two or three got through. No limit in this app could have changed that; the
 * ceiling belongs to the platform.
 *
 * So when Blob storage is configured, each file goes browser → Blob directly,
 * and only a small reference travels through the function. The server reads
 * that blob, parses it, and deletes it in the same request (see
 * lib/vercel-blob.ts) — the raw chat, with its real names and phone numbers,
 * never outlives the request that reads it.
 *
 * Without Blob storage configured — `npm run dev` with no token — the files
 * are posted directly as before. That path has no platform in front of it, so
 * nothing caps it.
 */

export const TRANSIENT_UPLOAD_PREFIX = 'transient-uploads/';

export interface UploadProgress {
  /** 1-based index of the file currently being sent. */
  fileIndex: number;
  fileCount: number;
  filename: string;
  /** 0–100 for this file. */
  percentage: number;
}

/** A reference to one uploaded blob, as /api/imports expects it. */
interface BlobRef {
  url: string;
  pathname: string;
  name: string;
  size: number;
}

/**
 * Put every file in Blob storage and return their references.
 *
 * Sequential rather than parallel: five simultaneous multi-megabyte uploads
 * compete for the same uplink and make every one of them slower, and the
 * progress readout becomes meaningless. One at a time is both faster in
 * practice and honestly reportable.
 */
async function uploadToBlob(
  files: File[],
  community: string,
  access: 'public' | 'private',
  onProgress?: (progress: UploadProgress) => void,
): Promise<BlobRef[]> {
  const refs: BlobRef[] = [];

  for (const [index, file] of files.entries()) {
    const result = await upload(`${TRANSIENT_UPLOAD_PREFIX}${file.name}`, file, {
      access,
      handleUploadUrl: '/api/imports/blob-upload',
      clientPayload: JSON.stringify({ community }),
      // Splits a large export into parts, uploads them in parallel and
      // retries the ones that fail — without this a single dropped chunk
      // 70MB into an 80MB export restarts the whole thing.
      multipart: true,
      onUploadProgress: ({ percentage }) =>
        onProgress?.({
          fileIndex: index + 1,
          fileCount: files.length,
          filename: file.name,
          percentage,
        }),
    });

    refs.push({
      url: result.url,
      pathname: result.pathname,
      name: file.name,
      size: file.size,
    });
  }

  return refs;
}

/**
 * Build the body for /api/imports: blob references when Blob storage is
 * configured, the files themselves when it isn't.
 */
export async function buildWhatsappUploadBody({
  files,
  community,
  period,
  group,
  blobAccess,
  onProgress,
}: {
  files: File[];
  community: string;
  period: { start: string; end: string };
  /** Pins a single file to one group — the fallback for an unidentifiable export. */
  group?: string;
  /** The Blob store's access level, or null when Blob storage isn't configured. */
  blobAccess: 'public' | 'private' | null;
  onProgress?: (progress: UploadProgress) => void;
}): Promise<FormData> {
  const body = new FormData();
  body.set('source', 'whatsapp');
  body.set('community', community);
  body.set('periodStart', period.start);
  body.set('periodEnd', period.end);
  if (group) body.set('group', group);

  if (blobAccess) {
    for (const ref of await uploadToBlob(files, community, blobAccess, onProgress)) {
      body.append('blob', JSON.stringify(ref));
    }
  } else {
    for (const file of files) body.append('file', file);
  }

  return body;
}
