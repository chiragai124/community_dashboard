import type { Registration } from '../types';

/**
 * Mapping the registration sheet's header row onto Registration fields.
 *
 * Pure and dependency-free so it can be reasoned about (and exercised) without
 * touching the Sheets API. lib/integrations/sheets.ts is the caller.
 *
 * Matching is by HEADER NAME, never position, so columns can be reordered or
 * added freely. Headers are compared with case, spaces and punctuation stripped
 * ("Targeted country" → "targetedcountry"), so "Target Country",
 * "target_country" and "TARGETED COUNTRY" all land on the same alias.
 */

/**
 * Accepted header aliases per field, already normalized.
 *
 * Real sheets name these columns whatever the form asked, so the lists are
 * deliberately generous — an unrecognised header costs a support round-trip,
 * while an extra alias costs nothing. Add to these rather than renaming a sheet.
 */
export const COLUMN_ALIASES: Record<keyof Registration, string[]> = {
  name: ['name', 'fullname', 'studentname', 'firstname', 'yourname'],
  email: ['email', 'emailaddress', 'mail', 'emailid'],
  country: [
    'country',
    'targetedcountry',
    'targetcountry',
    'destination',
    'destinationcountry',
    'countryofstudy',
    'studycountry',
    'preferredcountry',
    'countryofinterest',
  ],
  university: [
    'university',
    'universityname',
    'college',
    'school',
    'targeteduniversity',
    'targetuniversity',
  ],
  utmSource: ['utmsource', 'source'],
  utmMedium: ['utmmedium', 'medium'],
  utmCampaign: ['utmcampaign', 'campaign'],
  timestamp: [
    'timestamp',
    'date',
    'submittedat',
    'submissiondate',
    'createdat',
    'datetime',
    'signupdate',
  ],
};

/** The one field a row is useless without: it places the row in a week. */
export const REQUIRED_FIELDS: (keyof Registration)[] = ['timestamp'];

/** Lowercase and strip everything that isn't a letter or digit. */
export function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** header row -> { field: columnIndex } for every field the sheet provides. */
export function mapColumns(headers: string[]): Partial<Record<keyof Registration, number>> {
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
 * A message naming what's missing AND which headers would satisfy it, so the
 * next header mismatch is self-diagnosing instead of needing a code read.
 */
export function missingColumnsMessage(
  missing: (keyof Registration)[],
  headers: string[],
): string {
  const wanted = missing
    .map((field) => `${field} (accepts any of: ${COLUMN_ALIASES[field].join(', ')})`)
    .join('; ');
  return (
    `Sheet is missing required column(s): ${wanted}. ` +
    `Found headers: ${headers.filter((h) => h.trim() !== '').join(', ')}. ` +
    'Header matching ignores case, spaces and punctuation — add an alias in ' +
    'lib/integrations/sheet-columns.ts rather than renaming the sheet.'
  );
}
