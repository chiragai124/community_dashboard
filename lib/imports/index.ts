import type { ImportSource } from '../types';

export { extractShortio, ImportError } from './shortio';
export { extractGa4 } from './ga4';
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
};

export const IMPORT_SOURCES: ImportSource[] = ['shortio', 'ga4'];

export function isImportSource(value: unknown): value is ImportSource {
  return value === 'shortio' || value === 'ga4';
}
