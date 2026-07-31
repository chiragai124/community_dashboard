import type { ImportSource } from '../types';

export { extractShortio, ImportError } from './shortio';
export { extractGa4 } from './ga4';
export { analyseChatExport } from '../whatsapp/analyse';
export {
  chatImportFor,
  chatWeekFor,
  deleteChatImport,
  getChatImports,
  saveChatImport,
  type GroupChatImport,
} from '../whatsapp/store';
export {
  deleteImport,
  findImport,
  getImports,
  importId,
  importedWeek,
  mergedWeek,
  saveImport,
} from './store';

/**
 * The three file-import sources, and how they are described in the UI.
 *
 * `accept` is what the file picker offers and what the upload route enforces. A
 * Short.io workbook, a GA4 CSV and a WhatsApp .zip are not interchangeable, so
 * the wrong file for a source is refused with a message naming the file it wanted
 * rather than being parsed into nonsense.
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
  /**
   * True when the upload targets one GROUP rather than the whole community. A
   * chat export is one group's transcript, so it needs a group picker; the
   * Short.io and GA4 exports are community-wide.
   */
  perGroup?: boolean;
  /**
   * True when the file carries its own history and so backfills every week it
   * covers, making a week picker meaningless.
   */
  wholeHistory?: boolean;
}

export const SOURCE_META: Record<ImportSource, SourceMeta> = {
  shortio: {
    source: 'shortio',
    label: 'Short.io',
    fileDescription: 'Statistics workbook (.xlsx)',
    accept: '.xlsx',
    extensions: ['.xlsx'],
    provides: 'Total link clicks, and clicks per link path',
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
    provides: 'Active users, new users and sessions',
    steps: [
      'Open analytics.google.com and pick the right property.',
      'Go to Reports → Reports snapshot (the first item under Reports).',
      'Set the date range, top right, to the same Monday–Sunday week.',
      'Click the share icon (top right) → Download file → Download CSV.',
      'Upload that CSV here as-is. It contains several stacked reports separated by # lines; this reads Active users, New users, and Sessions from the traffic-source section.',
      'If the panel says a metric was not found, add it to the snapshot in GA4 — or tell me which section it lives in and the reader can be taught that layout.',
    ],
  },
  whatsapp: {
    source: 'whatsapp',
    label: 'WhatsApp chat',
    fileDescription: 'Chat export (.zip), one per group',
    accept: '.zip',
    extensions: ['.zip'],
    provides:
      'Members and growth, join source, activity, topics, questions and sentiment',
    perGroup: true,
    wholeHistory: true,
    steps: [
      'Open the group in WhatsApp.',
      'Tap the group name → scroll down → Export chat.',
      'Choose WITHOUT MEDIA. Media is not read and only makes the file huge.',
      'Save or share the .zip to your computer, then upload it here against the right group.',
      'Upload the FULL history, not a trimmed file: the export has no member list, so an absolute member count is only possible when the file reaches the group\u2019s creation. Without it you still get net change per week.',
      'One upload backfills every week the export covers, so there is no week to pick — re-upload later and it replaces the whole record for that group.',
      'Not in the file, and so not computable from it: poll votes (only the question is exported) and any 1:1 DMs (a group export contains none).',
    ],
  },
};

export const IMPORT_SOURCES: ImportSource[] = ['shortio', 'ga4', 'whatsapp'];

export function isImportSource(value: unknown): value is ImportSource {
  return value === 'shortio' || value === 'ga4' || value === 'whatsapp';
}
