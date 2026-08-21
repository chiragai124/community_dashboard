import { inflateRawSync } from 'node:zlib';

/**
 * Minimal ZIP archive reading, shared by the .xlsx reader (lib/xlsx.ts) and
 * the WhatsApp "Include media" .zip export (lib/imports/whatsapp.ts).
 *
 * Split into two steps deliberately: `listZipEntries` walks only the central
 * directory (cheap — no decompression), and `readZipEntryData` inflates one
 * entry on demand. A WhatsApp "with media" export can be a large archive of
 * mostly photos/videos/voice notes that are never read; listing first means
 * only the one entry actually needed (the chat .txt) is ever decompressed.
 */

export interface ZipEntryMeta {
  name: string;
  /** 0 = stored (no compression), 8 = DEFLATE. Any other value isn't supported. */
  method: number;
  compressedSize: number;
  localOffset: number;
}

/** The End Of Central Directory record sits at the end, after a comment of unknown length. */
function findEocd(buffer: Buffer): number {
  const min = Math.max(0, buffer.length - 66_000);
  for (let i = buffer.length - 22; i >= min; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

/**
 * Every entry's name, size and location — enumerated from the central
 * directory, which (unlike local file headers) is reliable even when the
 * writer streamed the archive with zeroed local sizes.
 */
export function listZipEntries(buffer: Buffer): ZipEntryMeta[] {
  const eocd = findEocd(buffer);
  if (eocd === -1) throw new Error('Not a valid ZIP archive (no end-of-central-directory record found).');

  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries: ZipEntryMeta[] = [];

  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break; // central directory signature
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);

    entries.push({ name, method, compressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

/**
 * Decompress one entry's bytes. Reads past the entry's own local file header
 * first — its name/extra-field lengths have their own values and need not
 * match the central directory's copy.
 */
export function readZipEntryData(buffer: Buffer, entry: ZipEntryMeta): Buffer {
  const localNameLength = buffer.readUInt16LE(entry.localOffset + 26);
  const localExtraLength = buffer.readUInt16LE(entry.localOffset + 28);
  const dataStart = entry.localOffset + 30 + localNameLength + localExtraLength;
  const raw = buffer.subarray(dataStart, dataStart + entry.compressedSize);

  if (entry.method === 0) return Buffer.from(raw);
  if (entry.method === 8) return inflateRawSync(raw);
  throw new Error(`Unsupported ZIP compression method (${entry.method}) for "${entry.name}".`);
}
