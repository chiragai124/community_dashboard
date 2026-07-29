import { google } from 'googleapis';
import type { IntegrationState, Registration } from '../types';
import { googleAuth, hasGoogleCreds } from './google-auth';
import { demoRegistrations } from '../demo';

/**
 * Registration data from the Google Sheet.
 *
 * Column matching is by header name, not position, so the sheet's columns can
 * be reordered without breaking anything. Each entry below lists the header
 * aliases accepted for that field (compared lowercase, non-alphanumerics stripped).
 */
const COLUMN_ALIASES: Record<keyof Registration, string[]> = {
  name: ['name', 'fullname', 'studentname', 'firstname'],
  email: ['email', 'emailaddress', 'mail'],
  country: ['country', 'destination', 'destinationcountry', 'countryofstudy'],
  university: ['university', 'universityname', 'college', 'school'],
  utmSource: ['utmsource', 'source'],
  utmMedium: ['utmmedium', 'medium'],
  utmCampaign: ['utmcampaign', 'campaign'],
  timestamp: ['timestamp', 'date', 'submittedat', 'createdat', 'datetime'],
};

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** header row -> { field: columnIndex } */
function mapColumns(headers: string[]): Partial<Record<keyof Registration, number>> {
  const normalized = headers.map(normalizeHeader);
  const map: Partial<Record<keyof Registration, number>> = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES) as [
    keyof Registration,
    string[],
  ][]) {
    const index = normalized.findIndex((h) => aliases.includes(h));
    if (index !== -1) map[field] = index;
  }
  return map;
}

/**
 * Sheets returns dates as whatever the cell displays. Accept ISO strings,
 * `DD/MM/YYYY`, `MM/DD/YYYY HH:mm:ss` and Sheets serial numbers.
 */
function parseTimestamp(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  // Sheets serial date: days since 1899-12-30.
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const serial = Number(trimmed);
    if (serial > 20000 && serial < 80000) {
      const ms = Math.round((serial - 25569) * 86400000);
      return new Date(ms).toISOString();
    }
  }

  const direct = new Date(trimmed);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString();

  // D/M/Y or M/D/Y with an optional time. Treat >12 in the first slot as a day.
  const match = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ ,]+(\d{1,2}):(\d{2}))?/);
  if (match) {
    const [, a, b, year, hour = '0', minute = '0'] = match;
    const first = Number(a);
    const second = Number(b);
    const [day, month] = first > 12 ? [first, second] : [second, first];
    const date = new Date(
      Date.UTC(Number(year), month - 1, day, Number(hour), Number(minute)),
    );
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }

  return '';
}

export interface SheetsResult {
  registrations: Registration[];
  state: IntegrationState;
}

export async function fetchRegistrations(): Promise<SheetsResult> {
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
  // Defaults to the whole first sheet; set GOOGLE_SHEETS_RANGE to narrow it.
  const range = process.env.GOOGLE_SHEETS_RANGE || 'A:Z';
  const fetchedAt = new Date().toISOString();

  if (!spreadsheetId || !hasGoogleCreds()) {
    return {
      registrations: demoRegistrations(),
      state: {
        name: 'sheets',
        label: 'Registrations (Sheets)',
        status: 'demo',
        message: !spreadsheetId
          ? 'Set GOOGLE_SHEETS_ID to pull real registrations.'
          : 'Add Google service-account credentials to pull real registrations.',
        fetchedAt,
      },
    };
  }

  try {
    const auth = googleAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const rows = res.data.values ?? [];

    if (rows.length < 2) {
      return {
        registrations: [],
        state: {
          name: 'sheets',
          label: 'Registrations (Sheets)',
          status: 'live',
          message: 'Sheet reached, but it has no data rows yet.',
          fetchedAt,
        },
      };
    }

    const columns = mapColumns((rows[0] as string[]).map((h) => String(h ?? '')));
    const missing = (['country', 'timestamp'] as const).filter((f) => columns[f] === undefined);
    if (missing.length > 0) {
      return {
        registrations: [],
        state: {
          name: 'sheets',
          label: 'Registrations (Sheets)',
          status: 'error',
          message: `Sheet is missing required column(s): ${missing.join(', ')}. Found: ${(rows[0] as string[]).join(', ')}`,
          fetchedAt,
        },
      };
    }

    const cell = (row: unknown[], field: keyof Registration): string => {
      const index = columns[field];
      if (index === undefined) return '';
      return String(row[index] ?? '').trim();
    };

    const registrations: Registration[] = rows
      .slice(1)
      .map((row) => ({
        name: cell(row, 'name'),
        email: cell(row, 'email'),
        country: cell(row, 'country'),
        university: cell(row, 'university'),
        utmSource: cell(row, 'utmSource'),
        utmMedium: cell(row, 'utmMedium'),
        utmCampaign: cell(row, 'utmCampaign'),
        timestamp: parseTimestamp(cell(row, 'timestamp')),
      }))
      // A row with no country and no campaign can't be attributed to a group.
      .filter((r) => r.timestamp !== '' && (r.country !== '' || r.utmCampaign !== ''));

    return {
      registrations,
      state: {
        name: 'sheets',
        label: 'Registrations (Sheets)',
        status: 'live',
        message: `${registrations.length.toLocaleString('en-US')} registration rows pulled.`,
        fetchedAt,
      },
    };
  } catch (err) {
    return {
      registrations: [],
      state: {
        name: 'sheets',
        label: 'Registrations (Sheets)',
        status: 'error',
        message: err instanceof Error ? err.message : 'Unknown Sheets error.',
        fetchedAt,
      },
    };
  }
}
