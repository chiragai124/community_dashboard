import { NextResponse } from 'next/server';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { SOURCE_META } from '@/lib/imports';
import { isCommunitySlug } from '@/lib/groups';
import { TRANSIENT_UPLOAD_PREFIX } from '@/lib/vercel-blob';

/**
 * Authorises one browser-to-Blob upload of a WhatsApp chat export.
 *
 * A with-media export runs to tens of megabytes, and a serverless platform
 * will not accept a request body anywhere near that (Vercel caps it at a few
 * MB, for the whole multipart body — which is why five files at once failed
 * where two or three got through). Raising this app's own limits could never
 * fix that: the ceiling is the platform's, not ours.
 *
 * So the file never passes through a function on the way in. The browser
 * uploads it straight to Blob storage with a short-lived token issued here,
 * then tells /api/imports where it landed; that route reads it, parses it,
 * and deletes it in the same request.
 *
 * This endpoint hands out a capability, so it is deliberately narrow: it
 * grants only the chat-export extensions, only under the transient prefix,
 * only up to the size limit, and only for a real community.
 */

export const runtime = 'nodejs';

/** Matches the per-file cap the import route enforces on a "with media" export. */
const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;

export async function POST(request: Request) {
  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!pathname.startsWith(TRANSIENT_UPLOAD_PREFIX)) {
          throw new Error('Uploads are only allowed under the transient-uploads prefix.');
        }
        if (!SOURCE_META.whatsapp.extensions.some((ext) => pathname.toLowerCase().endsWith(ext))) {
          throw new Error(
            `Only ${SOURCE_META.whatsapp.extensions.join(' or ')} chat exports can be uploaded.`,
          );
        }

        // The community the client says this batch is for. Validated here so a
        // token is never minted off an unchecked value, even though the import
        // route validates it again when the figures are actually filed.
        let community: unknown;
        try {
          community = clientPayload ? JSON.parse(clientPayload).community : null;
        } catch {
          throw new Error('Malformed upload payload.');
        }
        if (!isCommunitySlug(community)) throw new Error('Unknown community.');

        return {
          // WhatsApp hands out .zip and .txt; browsers label them
          // inconsistently, and octet-stream is what several send for a .zip
          // shared from a phone.
          allowedContentTypes: [
            'application/zip',
            'application/x-zip-compressed',
            'application/octet-stream',
            'text/plain',
          ],
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          // Two people uploading the same group's export at once must not
          // overwrite each other mid-parse.
          addRandomSuffix: true,
          tokenPayload: clientPayload,
        };
      },
      // Nothing to do on completion: the client calls /api/imports next, and
      // that request is what reads, parses and deletes the blob. Doing the
      // work here instead would mean parsing before the client has told us
      // which period to file it under.
      onUploadCompleted: async () => undefined,
    });

    return NextResponse.json(result);
  } catch (err) {
    // handleUpload throws for a rejected token as well as a malformed body;
    // both are the caller's to fix, and the message says which.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not authorise that upload.' },
      { status: 400 },
    );
  }
}
