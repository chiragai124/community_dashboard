import { inflateRawSync } from 'node:zlib';

/**
 * A minimal .xlsx reader: just enough to get cell text out of a workbook.
 *
 * An .xlsx file is a ZIP archive of XML parts. Rather than take on a
 * spreadsheet dependency for two numbers, this reads the archive directly —
 * Node's zlib provides the only hard part (DEFLATE), and the XML we need is
 * shallow enough to walk with a scanner.
 *
 * Deliberately narrow: it returns every cell as a trimmed string, in row order,
 * per sheet. No formulas, no styles, no dates-as-dates, no merged-cell geometry.
 * Short.io's export is a plain grid of labels and counts, which is all this has
 * to survive.
 */

/* ------------------------------------------------------------------ the ZIP */

interface ZipEntry {
  name: string;
  data: Buffer;
}

/**
 * Read a ZIP archive's entries.
 *
 * Walks the central directory backwards from the End Of Central Directory
 * record, which is the only reliable way to enumerate a ZIP — local headers can
 * carry zeroed sizes when the writer streamed the file.
 */
function readZip(buffer: Buffer): ZipEntry[] {
  const eocd = findEocd(buffer);
  if (eocd === -1) throw new Error('Not a valid .xlsx file (no ZIP end record found).');

  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];

  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break; // central directory signature
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);

    // Skip the local file header to reach the data: its own name and extra
    // fields have their own lengths, which need not match the central copy.
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);

    if (method === 0) {
      entries.push({ name, data: Buffer.from(raw) });
    } else if (method === 8) {
      entries.push({ name, data: inflateRawSync(raw) });
    }
    // Any other compression method is skipped: xlsx writers use store or deflate.

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

/** The EOCD record is at the end, after a comment of unknown length. */
function findEocd(buffer: Buffer): number {
  const min = Math.max(0, buffer.length - 66_000);
  for (let i = buffer.length - 22; i >= min; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

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
  const entries = readZip(buffer);
  const part = (name: string): string | undefined =>
    entries.find((e) => e.name === name)?.data.toString('utf8');

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
