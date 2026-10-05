import { NextResponse } from 'next/server';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
// Deliberately ./sources, not the ../../lib/imports barrel: that barrel pulls
// in the parsers and the persistence layer, and this route needs one list of
// file extensions. A module-load failure in code this route never calls
// should not be able to stop it minting a token.
import { SOURCE_META } from '@/lib/imports/sources';
import { isCommunitySlug } from '@/lib/groups';
import { TRANSIENT_UPLOAD_PREFIX } from '@/lib/vercel-blob';

/**
 * Authorises one browser-to-Blob upload of a WhatsApp chat export.
 *
 * A with-media export runs to tens of megabytes, and a serverless platform
 * will not accept a request body anywhere near that. So the file never passes
 * through a function on the way in: the browser uploads it straight to Blob
 * storage with a short-lived token issued here, then tells /api/imports where
 * it landed; that route reads it, parses it, and deletes it.
 *
 * This endpoint hands out a capability, so it is deliberately narrow: it
 * grants only the chat-export extensions, only under the transient prefix,
 * only up to the size limit, and only for a real community.
 *
 * **Errors are reported, not flattened.** The SDK's client-side failure for
 * anything that goes wrong here is the same opaque "Failed to retrieve the
 * client token" whatever the cause, so this route's own response is the only
 * place the real reason can survive. An earlier version caught everything and
 * returned a generic 400, which made a misconfigured store, a rejected
 * pathname and a crash indistinguishable from each other.
 */

export const runtime = 'nodejs';

/** Matches the per-file cap the import route enforces on a "with media" export. */
const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;

/** Thrown by the checks below; anything else reaching the catch is unexpected. */
class RejectedUpload extends Error {}

export async function POST(request: Request) {
  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  // Checked before handing off to the SDK so the failure names the missing
  // piece. Without it the SDK throws its own "No token found" message, which
  // reaches the browser as the same generic token error as everything else.
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      {
        error:
          'Blob storage is not configured on the server: BLOB_READ_WRITE_TOKEN is not set for ' +
          'this deployment. Connect a Blob store to the project, then redeploy — environment ' +
          'variables are read at deploy time, so setting one does not affect a build that is ' +
          'already live.',
      },
      { status: 503 },
    );
  }

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!pathname.startsWith(TRANSIENT_UPLOAD_PREFIX)) {
          throw new RejectedUpload(
            'Uploads are only allowed under the transient-uploads prefix.',
          );
        }
        if (!SOURCE_META.whatsapp.extensions.some((ext) => pathname.toLowerCase().endsWith(ext))) {
          throw new RejectedUpload(
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
          throw new RejectedUpload('Malformed upload payload.');
        }
        if (!isCommunitySlug(community)) throw new RejectedUpload('Unknown community.');

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
        };
      },
      /*
       * No onUploadCompleted, deliberately.
       *
       * Passing one — even an empty one — makes the SDK register a callback
       * URL on the token and have Blob call back into this route when the
       * upload finishes. There is nothing to do at that point: the browser
       * calls /api/imports next, and that request is what reads, parses and
       * deletes the blob. Registering the callback anyway added a round trip
       * that has to be publicly reachable, which a preview deployment behind
       * Vercel's deployment protection is not.
       */
    });

    return NextResponse.json(result);
  } catch (err) {
    // A rejected upload is the caller's to fix and says how.
    if (err instanceof RejectedUpload) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    // Anything else is ours. Log it — the browser only ever sees the SDK's
    // generic message, so the deployment log is where this has to be legible
    // — and pass the real text back rather than a placeholder.
    console.error('[blob-upload] could not issue a client token', err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `Could not authorise that upload: ${err.message}`
            : 'Could not authorise that upload.',
      },
      { status: 500 },
    );
  }
}
