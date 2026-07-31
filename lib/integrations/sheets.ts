import { google } from 'googleapis';
import type { IntegrationState, Registration } from '../types';
import { googleAuth, hasGoogleCreds } from './google-auth';
import { demoRegistrations } from '../demo';
import { REQUIRED_FIELDS, mapColumns, missingColumnsMessage } from './sheet-columns';
import { GOOGLE_CALL_OPTIONS, SOURCE_TIMEOUT_MS, errorState } from './shared';

/**
 * Registration data from the Google Sheet.
 *
 * Header-to-field matching lives in ./sheet-columns.ts — add an alias there when
 * a sheet names a column differently, rather than renaming the sheet.
 */

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
    // GOOGLE_CALL_OPTIONS disables googleapis' default retry — see shared.ts.
    //
    // The render options matter for speed on a big form-response sheet. The
    // default FORMATTED_VALUE makes Sheets locale-format every cell server-side
    // and return it as a string; UNFORMATTED_VALUE skips that work and sends a
    // smaller payload. Dates then arrive as serial numbers, which parseTimestamp
    // already understands — and which are unambiguous, unlike a formatted date
    // where 03/04 could be March or April. `fields` trims the response envelope.
    const startedAt = Date.now();
    const res = await sheets.spreadsheets.values.get(
      {
        spreadsheetId,
        range,
        valueRenderOption: 'UNFORMATTED_VALUE',
        dateTimeRenderOption: 'SERIAL_NUMBER',
        fields: 'values',
      },
      GOOGLE_CALL_OPTIONS,
    );
    const elapsedMs = Date.now() - startedAt;
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

    const headerRow = (rows[0] as string[]).map((h) => String(h ?? ''));
    const columns = mapColumns(headerRow);
    const missing = REQUIRED_FIELDS.filter((f) => columns[f] === undefined);
    if (missing.length > 0) {
      return {
        registrations: [],
        state: {
          name: 'sheets',
          label: 'Registrations (Sheets)',
          status: 'error',
          message: missingColumnsMessage(missing, headerRow),
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
      // A row without a usable timestamp can't be placed in a week. Country and
      // campaign are NOT required: attribution (lib/groups.ts) falls back to the
      // single sheets-fed community, so a sheet with neither column still counts.
      .filter((r) => r.timestamp !== '');

    // A sheet big enough to be near the timeout should say so, with the fix.
    const slowNote =
      elapsedMs > SOURCE_TIMEOUT_MS / 2
        ? ` — slow; narrow it with GOOGLE_SHEETS_RANGE (e.g. 'Responses!A:H')`
        : '';

    // Say plainly which optional columns were not found, so a silently-empty
    // source breakdown is explainable from the status pill alone.
    const absent = (['country', 'utmSource', 'utmCampaign'] as const).filter(
      (f) => columns[f] === undefined,
    );
    const note =
      absent.length > 0
        ? ` No ${absent.join('/')} column found (accepted names in sheet-columns.ts)${
            absent.includes('utmSource') ? '; leads group under “Other” by source' : ''
          }.`
        : '';

    return {
      registrations,
      state: {
        name: 'sheets',
        label: 'Registrations (Sheets)',
        status: 'live',
        message:
          `${registrations.length.toLocaleString('en-US')} registration rows pulled ` +
          `from ${rows.length.toLocaleString('en-US')} sheet rows in ${(elapsedMs / 1000).toFixed(1)}s` +
          `${slowNote}.${note}`,
        fetchedAt,
      },
    };
  } catch (err) {
    return {
      registrations: [],
      state: errorState('sheets', 'Registrations (Sheets)', err, fetchedAt),
    };
  }
}
