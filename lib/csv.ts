/**
 * A small RFC 4180 CSV reader.
 *
 * Hand-written rather than pulled from npm because the requirements are narrow
 * and the failure modes matter more than the features: these files come from
 * Google Sheets, GA4 and Short.io exports, so they carry quoted fields with
 * embedded commas and newlines, CRLF line endings, and a UTF-8 BOM that would
 * otherwise glue itself to the first header name and break column matching.
 */

/** Strip a UTF-8 byte-order mark. Sheets and GA4 both emit one. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Split CSV text into rows of raw cell strings.
 *
 * Quotes are handled per spec: a field may be wrapped in double quotes, and a
 * doubled quote inside one is a literal quote. Anything outside quotes splits on
 * commas and line breaks.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = stripBom(text);

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < src.length; i += 1) {
    const char = src[i];

    if (inQuotes) {
      if (char === '"') {
        // A doubled quote is an escaped quote; a lone one closes the field.
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      endField();
    } else if (char === '\r') {
      // CRLF: let the \n do the work. A lone \r still ends the row.
      if (src[i + 1] === '\n') i += 1;
      endRow();
    } else if (char === '\n') {
      endRow();
    } else {
      field += char;
    }
  }

  // A trailing newline leaves an empty pending row, which is not a data row.
  if (field !== '' || row.length > 0) endRow();

  return rows;
}

/**
 * Rows with the header row found and separated from the body.
 *
 * GA4's CSV export does not start with the header: it opens with `# ...` comment
 * lines describing the report and its date range, then a blank line, then the
 * real header. Short.io and Sheets exports start at the header. Skipping leading
 * comments and blanks handles all three without asking the user to edit the file.
 */
export interface CsvTable {
  header: string[];
  rows: string[][];
  /** Comment lines skipped before the header, e.g. GA4's report preamble. */
  preamble: string[];
}

export function readCsvTable(text: string): CsvTable {
  const all = parseCsv(text);
  const preamble: string[] = [];
  let index = 0;

  while (index < all.length) {
    const row = all[index];
    const first = (row[0] ?? '').trim();
    const isBlank = row.every((cell) => cell.trim() === '');
    const isComment = first.startsWith('#');
    if (!isBlank && !isComment) break;
    if (isComment) preamble.push(row.join(',').trim());
    index += 1;
  }

  if (index >= all.length) return { header: [], rows: [], preamble };

  const header = all[index].map((cell) => cell.trim());
  const rows = all
    .slice(index + 1)
    // GA4 appends further sections after a blank line; a fully blank row ends
    // the table we care about, but dropping blanks is enough in practice and
    // keeps a stray blank line mid-file from truncating real data.
    .filter((row) => row.some((cell) => cell.trim() !== ''));

  return { header, rows, preamble };
}
