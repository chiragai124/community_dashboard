import type { ImportSource } from '../types';

export { extractShortio, ImportError } from './shortio';
export { extractGa4 } from './ga4';
export { extractChatTextFromZip, extractWhatsapp } from './whatsapp';
export {
  deleteImport,
  findGa4Import,
  findImport,
  ga4Week,
  getImports,
  groupPeriods,
  importId,
  importIdForGlobal,
  importIdForPeriod,
  latestGroupPeriod,
  previousGroupPeriod,
  resetImports,
  saveImport,
  saveImports,
  shortioWeek,
} from './store';

/**
 * The two file-import sources, and how they are described in the UI.
 *
 * `accept` is what the file picker offers and what the upload route enforces.
 * Short.io exports a multi-sheet workbook; GA4 exports a stacked CSV. Neither is
 * interchangeable, so the wrong file for a source is refused with a message
 * saying which file it wanted rather than parsed into nonsense.
 */
export interface SourceMeta {
  source: ImportSource;
  /** Short name used in headings and buttons. */
  label: string;
  /** What the file is, in the exporting tool's own words. */
  fileDescription: string;
  accept: string;
  extensions: string[];
  /** What this upload fills in. */
  provides: string;
  /**
   * Click-by-click export steps. Kept here rather than only in the README so the
   * instructions render inside the import panel, next to the button they
   * describe — the place someone actually is when they need them.
   */
  steps: string[];
}

export const SOURCE_META: Record<ImportSource, SourceMeta> = {
  whatsapp: {
    source: 'whatsapp',
    label: 'WhatsApp',
    fileDescription: 'Chat export, with or without media (.zip or .txt)',
    accept: '.zip,.txt,text/plain,application/zip',
    extensions: ['.zip', '.txt'],
    provides:
      'Activity level, messages, active chatters, top voices, topics, sentiment, and an ' +
      'AI-generated status tag/summary/narrative for the report period you enter below. ' +
      'Total membership is entered manually per community, not derived from this export — ' +
      'see "Total members" on the Community tab.',
    steps: [
      "Open this group in WhatsApp, tap the group name to open Group info.",
      'Scroll down and tap Export chat, then choose either Include media or Without media — both work.',
      'Save or share the .zip (or .txt) file to somewhere you can upload it from.',
      "Upload the WHOLE file every time, not a trimmed one-week slice — the figures for the " +
        'report period you enter below are recomputed from scratch each time. With media, ' +
        'only the chat text inside the .zip is read — photos, videos and voice notes are ' +
        'ignored and never leave the archive.',
    ],
  },
  shortio: {
    source: 'shortio',
    label: 'Short.io',
    fileDescription: 'Statistics workbook (.xlsx)',
    accept: '.xlsx',
    extensions: ['.xlsx'],
    provides: "Community #2's total link clicks, and clicks per link path",
    steps: [
      'Open short.io and sign in, then go to Statistics in the left sidebar.',
      'Set the date range to the Monday–Sunday week you are reporting on.',
      'Leave the domain filter set to the domain holding your tracked links.',
      'Click Export (top right of the Statistics page) and choose Excel / .xlsx.',
      'Upload the downloaded workbook here, unopened and unedited — the sheet names are what this reads.',
      'Only two sheets are used: "General statistic" for the total, and "Top links" for clicks per link. The other sheets are ignored.',
    ],
  },
  ga4: {
    source: 'ga4',
    label: 'GA4',
    fileDescription: 'Reports snapshot (.csv)',
    accept: '.csv,text/csv',
    extensions: ['.csv'],
    provides: "Landing page traffic — active users, new users and sessions. Not community data: this describes the website, not either WhatsApp community.",
    steps: [
      'Open analytics.google.com and pick the right property.',
      'Go to Reports → Reports snapshot (the first item under Reports).',
      'Set the date range, top right, to the same Monday–Sunday week.',
      'Click the share icon (top right) → Download file → Download CSV.',
      'Upload that CSV here as-is. It contains several stacked reports separated by # lines; this reads Active users, New users, and Sessions from the traffic-source section.',
      'If the panel says a metric was not found, add it to the snapshot in GA4 — or tell me which section it lives in and the reader can be taught that layout.',
    ],
  },
};

export const IMPORT_SOURCES: ImportSource[] = ['shortio', 'ga4', 'whatsapp'];

export function isImportSource(value: unknown): value is ImportSource {
  return value === 'shortio' || value === 'ga4' || value === 'whatsapp';
}
