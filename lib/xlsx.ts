import { listZipEntries, readZipEntryData } from './zip';

/**
 * A minimal .xlsx reader: just enough to get cell text out of a workbook.
 *
 * An .xlsx file is a ZIP archive of XML parts. Rather than take on a
 * spreadsheet dependency for two numbers, this reads the archive directly via
 * lib/zip.ts, and the XML we need is shallow enough to walk with a scanner.
 *
 * Deliberately narrow: it returns every cell as a trimmed string, in row order,
 * per sheet. No formulas, no styles, no dates-as-dates, no merged-cell geometry.
 * Short.io's export is a plain grid of labels and counts, which is all this has
 * to survive.
 */

/* ------------------------------------------------------------------ the XML */

const XML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeXml(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    }
    return XML_ENTITIES[entity] ?? match;
  });
}

/** Concatenated text of every <t> element in a fragment. */
function textOf(fragment: string): string {
  let out = '';
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t\s*\/>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(fragment)) !== null) {
    out += decodeXml(match[1] ?? '');
  }
  return out;
}

/**
 * The shared string table. Cells of type `s` hold an index into this rather than
 * their own text, so it has to be resolved before any string cell can be read.
 */
function readSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const items: string[] = [];
  const re = /<si(?:\s[^>]*)?>([\s\S]*?)<\/si>|<si\s*\/>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    items.push(textOf(match[1] ?? '').trim());
  }
  return items;
}

/** "C7" → 2. Column letters are base-26 with A = 1. */
function columnIndex(ref: string): number {
  const letters = ref.replace(/[^A-Za-z]/g, '').toUpperCase();
  let index = 0;
  for (const char of letters) index = index * 26 + (char.charCodeAt(0) - 64);
  return Math.max(0, index - 1);
}

/**
 * One sheet as a grid of trimmed strings.
 *
 * Cells are placed by their own `r` reference rather than by encounter order,
 * because writers omit empty cells entirely — reading positionally would shift
 * every value after the first gap into the wrong column.
 */
function readSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  const rowRe = /<row(?:\s[^>]*)?>([\s\S]*?)<\/row>|<row\s[^>]*\/>/g;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRe.exec(xml)) !== null) {
    const body = rowMatch[1] ?? '';
    const cells: string[] = [];
    const cellRe = /<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = cellRe.exec(body)) !== null) {
      const attrs = cellMatch[1] ?? '';
      const content = cellMatch[2] ?? '';
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1] ?? '';
      // Anchored on a boundary so a style attribute can't be read as the type,
      // and case-sensitive letters allowed: the type is "inlineStr", not "inlinestr".
      const type = /(?:^|\s)t="([a-zA-Z]+)"/.exec(attrs)?.[1] ?? 'n';

      let value = '';
      if (type === 's') {
        const index = Number(/<v>([\s\S]*?)<\/v>/.exec(content)?.[1] ?? '');
        value = Number.isFinite(index) ? (shared[index] ?? '') : '';
      } else if (type === 'inlineStr') {
        value = textOf(content);
      } else if (type === 'str') {
        value = decodeXml(/<v>([\s\S]*?)<\/v>/.exec(content)?.[1] ?? '');
      } else {
        value = decodeXml(/<v>([\s\S]*?)<\/v>/.exec(content)?.[1] ?? '');
      }

      const at = ref ? columnIndex(ref) : cells.length;
      while (cells.length < at) cells.push('');
      cells[at] = value.trim();
    }

    rows.push(cells);
  }

  return rows;
}

/* ---------------------------------------------------------------- workbook */

export interface XlsxSheet {
  name: string;
  rows: string[][];
}

/**
 * Every sheet in the workbook, in workbook order, with its declared name.
 *
 * Sheet names come from workbook.xml and are mapped to parts through the
 * relationship ids, so a workbook whose sheet files are not numbered in tab
 * order still reports the right name against the right grid.
 */
export function readXlsx(buffer: Buffer): XlsxSheet[] {
  const entries = listZipEntries(buffer);
  const part = (name: string): string | undefined => {
    const entry = entries.find((e) => e.name === name);
    // "store or deflate" only: xlsx writers don't use other ZIP methods, and
    // an unsupported one here just means "this part isn't readable" rather
    // than failing the whole workbook.
    if (!entry || (entry.method !== 0 && entry.method !== 8)) return undefined;
    return readZipEntryData(buffer, entry).toString('utf8');
  };

  const workbook = part('xl/workbook.xml');
  if (!workbook) throw new Error('Not a valid .xlsx file (no xl/workbook.xml inside).');

  const shared = readSharedStrings(part('xl/sharedStrings.xml'));

  // rel id -> part path, from the workbook's relationships.
  const rels = new Map<string, string>();
  const relsXml = part('xl/_rels/workbook.xml.rels') ?? '';
  const relRe = /<Relationship\s([^>]*)\/>/g;
  let relMatch: RegExpExecArray | null;
  while ((relMatch = relRe.exec(relsXml)) !== null) {
    const attrs = relMatch[1];
    const id = /Id="([^"]+)"/.exec(attrs)?.[1];
    const target = /Target="([^"]+)"/.exec(attrs)?.[1];
    if (id && target) {
      rels.set(id, target.replace(/^\/?xl\//, '').replace(/^\//, ''));
    }
  }

  const sheets: XlsxSheet[] = [];
  const sheetRe = /<sheet\s([^>]*)\/>/g;
  let sheetMatch: RegExpExecArray | null;
  let fallbackIndex = 0;

  while ((sheetMatch = sheetRe.exec(workbook)) !== null) {
    const attrs = sheetMatch[1];
    const name = decodeXml(/name="([^"]*)"/.exec(attrs)?.[1] ?? '');
    const relId = /r:id="([^"]+)"/.exec(attrs)?.[1] ?? '';
    fallbackIndex += 1;
    const target = rels.get(relId) ?? `worksheets/sheet${fallbackIndex}.xml`;
    const xml = part(`xl/${target}`);
    if (!xml) continue;
    sheets.push({ name, rows: readSheet(xml, shared) });
  }

  return sheets;
}

/** Lowercase, letters and digits only — for tolerant sheet/header matching. */
export function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * "1,204" / " 37 " / "12.0" → a number, or null when the cell holds no number.
 * Null rather than 0 matters: a missing figure must not read as a real zero.
 */
export function toNumber(raw: string): number | null {
  const cleaned = raw.replace(/[,\s%]/g, '');
  if (cleaned === '' || !/\d/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
