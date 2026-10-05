import type { ImportSource } from '../types';

export { extractShortio, ImportError } from './shortio';
export { extractGa4 } from './ga4';
export { extractChatTextFromZip, extractWhatsapp } from './whatsapp';
export {
  deleteImport,
  getImports,
  groupPeriods,
  importId,
  importIdForGlobal,
  importIdForPeriod,
  importsOfSource,
  latestGroupPeriod,
  previousGroupPeriod,
  resetImports,
  saveImport,
  saveImports,
} from './store';
export {
  coveredRange,
  periodLength,
  resolveGa4,
  resolveShortio,
  type FigureOrigin,
  type ResolvedImport,
} from './resolve';
export { groupPeriodFor } from './period-match';

/*
 * Source metadata lives in ./sources, which imports nothing but types.
 *
 * This barrel pulls in the persistence layer and the parsers, so anything
 * importing SOURCE_META from here inherits all of that — and any module-load
 * failure anywhere in it. The blob-upload token route needs only the
 * extension list, so it imports ./sources directly and stays independent of
 * code it never calls.
 */
export { IMPORT_SOURCES, SOURCE_META, isImportSource, type SourceMeta } from './sources';
