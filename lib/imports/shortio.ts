import type { LinkClicks, ShortioFigures } from '../types';
import { normalizeKey, readXlsx, toNumber, type XlsxSheet } from '../xlsx';

/**
 * Pulling two things out of a Short.io statistics workbook: the total click
 * count, and clicks per link path.
 *
 * The export has ten-odd sheets (General statistic, OS, Browser, Country, City,
 * Social, Referrer, UTM breakdowns, Top links, Click statistics). Only two are
 * read — "General statistic" for the total and "Top links" for the per-path
 * breakdown — and everything else is ignored rather than guessed at.
 *
 * Matching is deliberately loose: sheet names and column headers are compared
 * with case, spaces and punctuation stripped, and each figure has several
 * accepted labels. Short.io changing "Total clicks" to "Clicks" should not
 * break a weekly upload.
 */

export class ImportError extends Error {}

const TOP_LINKS_SHEETS = ['toplinks', 'links', 'topurls'];
const GENERAL_SHEETS = ['generalstatistic', 'generalstatistics', 'general', 'summary', 'overview'];

const CLICK_HEADERS = ['clicks', 'totalclicks', 'clickcount', 'humanclicks', 'visits', 'count'];
const PATH_HEADERS = [
  'shortlink',
  'shorturl',
  'path',
  'slug',
  'link',
  'url',
  'originalurl',
  'title',
  'name',
];

export interface ShortioExtract {
  figures: ShortioFigures;
  notes: string[];
}

/** The first sheet whose normalized name matches, or contains, one of `wanted`. */
function findSheet(sheets: XlsxSheet[], wanted: string[]): XlsxSheet | undefined {
  const keyed = sheets.map((s) => ({ sheet: s, key: normalizeKey(s.name) }));
  return (
    keyed.find((s) => wanted.includes(s.key))?.sheet ??
    keyed.find((s) => wanted.some((w) => s.key.includes(w)))?.sheet
  );
}

/**
 * The header row of a table, found by looking for the column we need rather than
 * assuming row 0. Short.io prefixes sheets with a title row and sometimes a
 * blank, so the header is rarely first.
 */
function findHeaderRow(
  rows: string[][],
  required: string[],
): { index: number; columns: string[] } | null {
  for (let i = 0; i < Math.min(rows.length, 25); i += 1) {
    const columns = rows[i].map(normalizeKey);
    if (columns.some((c) => required.includes(c))) return { index: i, columns };
  }
  return null;
}

/** Clicks per link path, from the "Top links" sheet. */
function readTopLinks(sheet: XlsxSheet, notes: string[]): LinkClicks[] {
  const header = findHeaderRow(sheet.rows, CLICK_HEADERS);
  if (!header) {
    notes.push(
      `Sheet "${sheet.name}" had no clicks column, so there is no per-link breakdown.`,
    );
    return [];
  }

  const clicksAt = header.columns.findIndex((c) => CLICK_HEADERS.includes(c));
  // Prefer a real link/path column; fall back to the first non-clicks column,
  // which is where Short.io puts the link when the header is unusual.
  const pathAt = (() => {
    for (const wanted of PATH_HEADERS) {
      const at = header.columns.indexOf(wanted);
      if (at !== -1 && at !== clicksAt) return at;
    }
    return header.columns.findIndex((c, i) => i !== clicksAt && c !== '');
  })();

  if (pathAt === -1) {
    notes.push(`Sheet "${sheet.name}" had a clicks column but no link column.`);
    return [];
  }

  const byPath = new Map<string, number>();
  for (const row of sheet.rows.slice(header.index + 1)) {
    const path = (row[pathAt] ?? '').trim();
    const clicks = toNumber(row[clicksAt] ?? '');
    if (path === '' || clicks === null) continue;
    // A totals row would otherwise appear as a link called "Total".
    if (/^(total|totals|sum|grand total)$/i.test(path)) continue;
    byPath.set(path, (byPath.get(path) ?? 0) + clicks);
  }

  const links = [...byPath.entries()]
    .map(([path, clicks]) => ({ path, clicks }))
    .sort((a, b) => b.clicks - a.clicks);

  notes.push(
    links.length > 0
      ? `${links.length} link(s) read from sheet "${sheet.name}".`
      : `Sheet "${sheet.name}" had no readable link rows.`,
  );
  return links;
}

/**
 * The headline total, from "General statistic": the first row whose label
 * mentions clicks, taking the first number on that row.
 */
function readTotalClicks(sheet: XlsxSheet | undefined, notes: string[]): number | null {
  if (!sheet) return null;

  const scan = (predicate: (label: string) => boolean): number | null => {
    for (const row of sheet.rows) {
      const label = normalizeKey(row[0] ?? '');
      if (label === '' || !predicate(label)) continue;
      for (const cell of row.slice(1)) {
        const value = toNumber(cell);
        if (value !== null) return value;
      }
    }
    return null;
  };

  // "Total clicks" beats a bare "Clicks", which beats "Unique clicks" — take the
  // most specific label first so the total isn't quietly read off another row.
  const exact = scan((label) => label === 'totalclicks' || label === 'allclicks');
  if (exact !== null) {
    notes.push(`Total clicks read from "${sheet.name}" (Total clicks row).`);
    return exact;
  }
  const loose = scan((label) => label.includes('click') && !label.includes('unique'));
  if (loose !== null) {
    notes.push(`Total clicks read from "${sheet.name}" (first clicks row).`);
    return loose;
  }
  return null;
}

export function extractShortio(buffer: Buffer, filename: string): ShortioExtract {
  let sheets: XlsxSheet[];
  try {
    sheets = readXlsx(buffer);
  } catch (err) {
    throw new ImportError(
      `${filename} could not be read as an .xlsx workbook` +
        `${err instanceof Error ? `: ${err.message}` : '.'}`,
    );
  }

  if (sheets.length === 0) throw new ImportError(`${filename} contains no sheets.`);

  const notes: string[] = [];
  const topLinks = findSheet(sheets, TOP_LINKS_SHEETS);
  const general = findSheet(sheets, GENERAL_SHEETS);

  if (!topLinks && !general) {
    throw new ImportError(
      `${filename} has neither a "Top links" nor a "General statistic" sheet. ` +
        `Sheets found: ${sheets.map((s) => s.name).join(', ')}. ` +
        'Export the full statistics workbook from Short.io rather than a single sheet.',
    );
  }

  const links = topLinks ? readTopLinks(topLinks, notes) : [];
  const reported = readTotalClicks(general, notes);
  const summed = links.reduce((sum, l) => sum + l.clicks, 0);

  // The reported total is authoritative — it counts every link, including any the
  // Top links sheet truncated away. Falling back to the sum keeps the card
  // populated when the General statistic sheet is missing or worded differently.
  let totalClicks: number;
  if (reported !== null) {
    totalClicks = reported;
    if (links.length > 0 && summed > reported) {
      notes.push(
        `Per-link clicks sum to ${summed.toLocaleString('en-US')}, above the reported ` +
          `total of ${reported.toLocaleString('en-US')} — the total is shown as reported.`,
      );
    }
  } else {
    totalClicks = summed;
    notes.push('No total-clicks row found, so the total is the sum of the per-link clicks.');
  }

  if (totalClicks === 0 && links.length === 0) {
    throw new ImportError(
      `${filename} produced no clicks and no links. ` +
        `Sheets found: ${sheets.map((s) => s.name).join(', ')}.`,
    );
  }

  return { figures: { totalClicks, links }, notes };
}
