import type { Ga4Figures } from '../types';
import { parseCsv } from '../csv';
import { normalizeKey, toNumber } from '../xlsx';
import { ImportError } from './shortio';

/**
 * Pulling three numbers out of a GA4 "Reports snapshot" CSV: active users, new
 * users and sessions.
 *
 * The file is not one table. It is several small reports stacked together —
 * Active users, Page titles, Traffic sources, City breakdown, daily new and
 * returning users — each preceded by a block of `#` comment lines. So the file
 * is split into sections first, and each figure is then taken from the section
 * that actually reports it.
 *
 * Every figure records WHICH section it came from. Snapshot layouts shift between
 * GA4 property configurations, and a number with no provenance is a number
 * nobody can check.
 */

interface Section {
  /** The `#` comment lines that introduced this section. */
  comments: string[];
  header: string[];
  rows: string[][];
}

const ACTIVE_USERS = ['activeusers', 'users', 'totalusers'];
const NEW_USERS = ['newusers', 'newusers1', 'firsttimeusers'];
const SESSIONS = ['sessions', 'totalsessions'];
/** Columns that mark a section as the traffic-source breakdown. */
const SOURCE_DIMENSIONS = [
  'sessionsourcemedium',
  'sourcemedium',
  'sessionsource',
  'source',
  'sessionmedium',
  'sessiondefaultchannelgroup',
  'sessionprimarychannelgroup',
  'firstuserprimarychannelgroup',
  'defaultchannelgroup',
  'channelgroup',
];

export interface Ga4Extract {
  figures: Ga4Figures;
  notes: string[];
  /** The report window GA4 stamped into the comments, when it declares one. */
  dateRange: { start: string; end: string } | null;
}

/** Split the export on its `#` comment blocks into one table per report. */
function splitSections(text: string): Section[] {
  const rows = parseCsv(text);
  const sections: Section[] = [];
  let comments: string[] = [];
  let body: string[][] = [];

  const flush = () => {
    const dataRows = body.filter((r) => r.some((c) => c.trim() !== ''));
    if (dataRows.length > 0) {
      sections.push({
        comments,
        header: dataRows[0].map((c) => c.trim()),
        rows: dataRows.slice(1),
      });
    }
    comments = [];
    body = [];
  };

  for (const row of rows) {
    const first = (row[0] ?? '').trim();
    if (first.startsWith('#')) {
      // A comment after a table means the next section is starting.
      if (body.length > 0) flush();
      const text = first.replace(/^#+\s*/, '').trim();
      if (text !== '' && !/^-+$/.test(text)) comments.push(text);
      continue;
    }
    body.push(row);
  }
  flush();

  return sections;
}

/** A short human name for a section, for the provenance note. */
function sectionLabel(section: Section): string {
  const named = section.comments.find(
    (c) => !/^\d{8}-\d{8}$/.test(c) && !/^reports? snapshot$/i.test(c),
  );
  const header = section.header.filter((h) => h !== '').join(' / ');
  return named ? `${named} (${header})` : header || 'unnamed section';
}

/** GA4 stamps the window as `YYYYMMDD-YYYYMMDD` in a comment line. */
function findDateRange(sections: Section[]): { start: string; end: string } | null {
  for (const section of sections) {
    for (const comment of section.comments) {
      const match = /^(\d{8})-(\d{8})$/.exec(comment);
      if (match) {
        const iso = (raw: string) =>
          `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
        return { start: iso(match[1]), end: iso(match[2]) };
      }
    }
  }
  return null;
}

/**
 * Read one metric out of the sections.
 *
 * `preferDimensions` is what keeps sessions honest: the snapshot reports sessions
 * in more than one place, and the user asked for the source/medium section
 * specifically, so a section carrying a source dimension is chosen ahead of any
 * other that merely has a Sessions column.
 *
 * Within the chosen section the metric column is summed over every row. For a
 * single-value card that is a one-row sum; for a breakdown it is the total across
 * its rows — which is the same number GA4 shows above the breakdown.
 */
function readMetric(
  sections: Section[],
  aliases: string[],
  options: { preferDimensions?: string[] } = {},
): { value: number; note: string } | null {
  const candidates = sections
    .map((section) => {
      const keys = section.header.map(normalizeKey);
      const at = keys.findIndex((k) => aliases.includes(k));
      return { section, keys, at };
    })
    .filter((c) => c.at !== -1 && c.section.rows.length > 0);

  if (candidates.length === 0) return null;

  const preferred = options.preferDimensions
    ? candidates.find((c) =>
        c.keys.some((k) => options.preferDimensions?.includes(k)),
      )
    : undefined;
  const chosen = preferred ?? candidates[0];

  let sum = 0;
  let counted = 0;
  for (const row of chosen.section.rows) {
    const label = (row[0] ?? '').trim();
    // GA4 breakdowns sometimes end with their own totals row; adding it would
    // double the figure.
    if (/^(total|totals|grand total)$/i.test(label)) continue;

    // A single-metric card is one column holding one number. If such a row
    // arrived with several cells, an unquoted thousands separator split it —
    // "1,284" became "1","284" — so rejoin before parsing. Reading column 0
    // alone would silently report 1 instead of 1,284.
    const raw =
      chosen.section.header.length === 1 && row.length > 1
        ? row.join(',')
        : (row[chosen.at] ?? '');
    const value = toNumber(raw);
    if (value === null) continue;
    sum += value;
    counted += 1;
  }

  if (counted === 0) return null;

  const label = sectionLabel(chosen.section);
  const note =
    counted === 1
      ? `from “${label}”.`
      : `from “${label}”, totalled over ${counted} rows.`;
  return { value: sum, note };
}

export function extractGa4(text: string, filename: string): Ga4Extract {
  const sections = splitSections(text);
  if (sections.length === 0) {
    throw new ImportError(
      `${filename} has no readable tables. Export the Reports snapshot as CSV ` +
        '(Share this report → Download file → Download CSV).',
    );
  }

  const notes: string[] = [];
  const active = readMetric(sections, ACTIVE_USERS);
  const newUsers = readMetric(sections, NEW_USERS);
  // The user asked for sessions from the source/medium section specifically.
  const sessions = readMetric(sections, SESSIONS, { preferDimensions: SOURCE_DIMENSIONS });

  if (active) notes.push(`Active users ${active.note}`);
  else notes.push('No Active users column found in this export.');
  if (newUsers) notes.push(`New users ${newUsers.note}`);
  else notes.push('No New users column found in this export.');
  if (sessions) notes.push(`Sessions ${sessions.note}`);
  else notes.push('No Sessions column found in this export.');

  if (!active && !newUsers && !sessions) {
    throw new ImportError(
      `${filename} contained none of Active users, New users or Sessions. ` +
        `Sections found: ${sections.map(sectionLabel).join(' · ')}.`,
    );
  }

  return {
    figures: {
      // Null, never 0, for a figure the export didn't contain — a missing metric
      // must not render as a real zero.
      activeUsers: active?.value ?? null,
      newUsers: newUsers?.value ?? null,
      sessions: sessions?.value ?? null,
    },
    notes,
    dateRange: findDateRange(sections),
  };
}
