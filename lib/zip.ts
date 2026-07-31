import { inflateRawSync } from 'node:zlib';

/**
 * A minimal ZIP reader.
 *
 * Shared by two importers that both take ZIP archives: `.xlsx` workbooks (a ZIP
 * of XML parts) and WhatsApp chat exports (a ZIP containing `_chat.txt`). Node's
 * zlib supplies DEFLATE, which is the only hard part, so neither needs a
 * third-party archive dependency.
 */

export interface ZipEntry {
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
export function readZip(buffer: Buffer): ZipEntry[] {
  const eocd = findEocd(buffer);
  if (eocd === -1) throw new Error('Not a valid ZIP file (no end-of-archive record found).');

  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];

  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > buffer.length) break;
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
      try {
        entries.push({ name, data: inflateRawSync(raw) });
      } catch {
        // A single unreadable member must not lose the rest of the archive —
        // WhatsApp exports carry media files we don't read anyway.
      }
    }
    // Any other compression method is skipped; these writers use store or deflate.

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
