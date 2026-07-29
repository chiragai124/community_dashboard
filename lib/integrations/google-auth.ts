import { google } from 'googleapis';

/**
 * One service-account credential drives both Google integrations (Sheets and
 * the GA4 Data API). Share the registration sheet with the service account's
 * email, and add that same email as a Viewer on the GA4 property.
 *
 * Credentials are read from either:
 *   GOOGLE_SERVICE_ACCOUNT_JSON  — the whole key file, as one JSON string
 *   GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY — the two fields separately
 *     (\n escapes in the private key are unescaped for you)
 */

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/analytics.readonly',
];

export interface GoogleCreds {
  clientEmail: string;
  privateKey: string;
}

export function readGoogleCreds(): GoogleCreds | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { client_email?: string; private_key?: string };
      if (parsed.client_email && parsed.private_key) {
        return {
          clientEmail: parsed.client_email,
          privateKey: parsed.private_key.replace(/\\n/g, '\n'),
        };
      }
    } catch {
      // Fall through to the split-variable form below.
    }
  }

  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;
  if (clientEmail && privateKey) {
    return { clientEmail, privateKey: privateKey.replace(/\\n/g, '\n') };
  }

  return null;
}

export function hasGoogleCreds(): boolean {
  return readGoogleCreds() !== null;
}

/**
 * Returns undefined (not null) when credentials are absent, so it can be passed
 * straight to a googleapis client's `auth` option. The return type is left to
 * inference: googleapis bundles its own copy of google-auth-library, and naming
 * the type explicitly picks the wrong one.
 */
export function googleAuth() {
  const creds = readGoogleCreds();
  if (!creds) return undefined;
  return new google.auth.GoogleAuth({
    credentials: { client_email: creds.clientEmail, private_key: creds.privateKey },
    scopes: SCOPES,
  });
}
