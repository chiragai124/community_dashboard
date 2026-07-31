import type { IntegrationName, IntegrationState } from '../types';

/**
 * Shared limits and helpers for the three automated pulls.
 *
 * The dashboard renders on the server, so a pull that hangs, retries in a loop
 * or throws asynchronously doesn't just make a number missing — it can take the
 * whole streamed page response down with it. Everything here exists to keep an
 * integration's bad day contained to its own status pill.
 */

/** No single source may hold up a page render longer than this. */
export const SOURCE_TIMEOUT_MS = Number(process.env.INTEGRATION_TIMEOUT_MS ?? 15_000);

/**
 * Per-call options for every googleapis request.
 *
 * `retry: false` is load-bearing, not a preference. googleapis-common defaults
 * `retry` to true (see apirequest.js: `options.retry === undefined ? true`), and
 * on retry gaxios re-sends the same request options through node-fetch. For a
 * POST with a body — GA4's runReport — that means re-transferring a body whose
 * ArrayBuffer was already detached by the first attempt, which throws
 * "TypeError: ArrayBuffer is not detachable and could not be cloned" from
 * outside our await chain and breaks the response stream ("failed to pipe
 * response"). One attempt per page render, with our own timeout, avoids that
 * entirely; the cache and the Refresh button already give us retries at a level
 * where a failure is just a pill turning red.
 */
export const GOOGLE_CALL_OPTIONS = {
  retry: false,
  timeout: SOURCE_TIMEOUT_MS,
};

/**
 * Reduce anything thrown into a short, single-line, plain string.
 *
 * API errors can carry an entire HTML error page, embedded newlines, or a
 * non-Error value. This message is rendered into a `title` attribute and the
 * status pills, so it has to stay small and boring.
 */
export function sanitizeMessage(value: unknown, maxLength = 300): string {
  // A thrown null/undefined must not render as the literal word "undefined".
  if (value === null || value === undefined) return 'Unknown error.';

  const raw =
    value instanceof Error
      ? value.message
      : typeof value === 'string'
        ? value
        : (() => {
            try {
              return JSON.stringify(value) ?? String(value);
            } catch {
              return String(value);
            }
          })();

  const flattened = String(raw ?? '')
    // Drop tags first, so an HTML error page collapses to its text.
    .replace(/<[^>]*>/g, ' ')
    // Control characters (including newlines) become spaces.
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (flattened === '') return 'Unknown error.';
  return flattened.length > maxLength
    ? `${flattened.slice(0, maxLength - 1)}…`
    : flattened;
}

/**
 * A hint for the failures that are worth naming, since the raw API message is
 * often opaque about what the operator actually has to change.
 */
export function credentialHint(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid_grant') || m.includes('account not found')) {
    return ' Check GOOGLE_CLIENT_EMAIL matches the key, and that the service account still exists.';
  }
  if (m.includes('decoder') || m.includes('asn.1') || m.includes('pem')) {
    return ' GOOGLE_PRIVATE_KEY looks malformed — it must keep its \\n escapes and be wrapped in double quotes.';
  }
  if (m.includes('permission') || m.includes('403') || m.includes('forbidden')) {
    return ' Share the sheet (and add the GA4 property viewer) with the service-account email.';
  }
  if (m.includes('not found') || m.includes('404')) {
    return ' Check GOOGLE_SHEETS_ID / GA4_PROPERTY_ID.';
  }
  if (m.includes('api has not been used') || m.includes('disabled')) {
    return ' Enable the Google Sheets API and Google Analytics Data API in that Cloud project.';
  }
  if (m.includes('abort') || m.includes('timeout')) {
    return ` The source didn't answer within ${Math.round(SOURCE_TIMEOUT_MS / 1000)}s.`;
  }
  return '';
}

/** An error state for a source, with the message already sanitized. */
export function errorState(
  name: IntegrationName,
  label: string,
  err: unknown,
  fetchedAt: string,
): IntegrationState {
  const message = sanitizeMessage(err);
  return {
    name,
    label,
    status: 'error',
    message: `${message}${credentialHint(message)}`,
    fetchedAt,
  };
}

/**
 * Resolve `promise`, or reject with a timeout error once SOURCE_TIMEOUT_MS
 * passes, so a slow source can't hold the page open.
 *
 * Crucially, the underlying request is NOT cancelled: when it finishes after we
 * stopped waiting, `onLate` receives the result. Without that, a source which is
 * merely slower than the budget can never succeed — every render abandons it,
 * nothing is ever cached, and the timeout repeats forever. With it, the first
 * slow pull still populates the cache and the next load is instant.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  label: string,
  onLate?: (result: T) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let gaveUp = false;

    const timer = setTimeout(() => {
      gaveUp = true;
      reject(
        new Error(
          `${label} timed out after ${SOURCE_TIMEOUT_MS}ms. The request is still ` +
            'running; its result will be used on the next load.',
        ),
      );
    }, SOURCE_TIMEOUT_MS);

    promise.then(
      (value) => {
        clearTimeout(timer);
        if (gaveUp) onLate?.(value);
        else resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        // A late failure has nowhere to go — the render already moved on.
        if (!gaveUp) reject(err);
      },
    );
  });
}
