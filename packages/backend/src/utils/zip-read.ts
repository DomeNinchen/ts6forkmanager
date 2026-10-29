// Reads the ZIPs this app writes itself (zip-stream.ts): stored entries, no ZIP64. Enough to take
// back a downloaded backup; anything else (compressed entries, a ZIP64 archive) is refused with a
// reason instead of being half understood.
import fs from 'node:fs';
import { crc32 } from 'node:zlib';

const SIGNATURE_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const SIGNATURE_CENTRAL_HEADER = 0x02014b50;
const SIGNATURE_LOCAL_HEADER = 0x04034b50;
const END_RECORD_BYTES = 22;
const MAX_COMMENT_BYTES = 0xffff;

export interface ZipEntry {
  name: string;
  crc: number;
  size: number;
  /** Where the entry's data starts in the file. */
  dataOffset: number;
}

export class ZipReadError extends Error {}

function readAt(fd: number, position: number, length: number): Buffer {
  const buf = Buffer.alloc(length);
  const n = fs.readSync(fd, buf, 0, length, position);
  if (n !== length) throw new ZipReadError('The ZIP file is cut off');
  return buf;
}

export function isZip(file: string): boolean {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(4);
    return fs.readSync(fd, head, 0, 4, 0) === 4 && head.readUInt32LE(0) === SIGNATURE_LOCAL_HEADER;
  } finally {
    fs.closeSync(fd);
  }
}

/** The entries of a ZIP, from its central directory. */
export function listZip(file: string): ZipEntry[] {
  const size = fs.statSync(file).size;
  const fd = fs.openSync(file, 'r');
  try {
    // The end record sits in the last 22 bytes plus at most a 64 KiB comment.
    const tailLength = Math.min(size, END_RECORD_BYTES + MAX_COMMENT_BYTES);
    const tail = readAt(fd, size - tailLength, tailLength);
    let end = -1;
    for (let i = tailLength - END_RECORD_BYTES; i >= 0; i--) {
      if (tail.readUInt32LE(i) === SIGNATURE_END_OF_CENTRAL_DIRECTORY) { end = i; break; }
    }
    if (end < 0) throw new ZipReadError('Not a ZIP file, or it is cut off');
    const count = tail.readUInt16LE(end + 10);
    const directorySize = tail.readUInt32LE(end + 12);
    const directoryOffset = tail.readUInt32LE(end + 16);
    if (count === 0xffff || directoryOffset === 0xffffffff) throw new ZipReadError('ZIP64 archives are not supported');
    if (directoryOffset + directorySize > size) throw new ZipReadError('The ZIP file is cut off');

    const directory = readAt(fd, directoryOffset, directorySize);
    const entries: ZipEntry[] = [];
    let at = 0;
    for (let i = 0; i < count; i++) {
      if (directory.readUInt32LE(at) !== SIGNATURE_CENTRAL_HEADER) throw new ZipReadError('The ZIP directory is damaged');
      const method = directory.readUInt16LE(at + 10);
      const crc = directory.readUInt32LE(at + 16);
      const compressed = directory.readUInt32LE(at + 20);
      const uncompressed = directory.readUInt32LE(at + 24);
      const nameLength = directory.readUInt16LE(at + 28);
      const extraLength = directory.readUInt16LE(at + 30);
      const commentLength = directory.readUInt16LE(at + 32);
      const localOffset = directory.readUInt32LE(at + 42);
      const name = directory.toString('utf8', at + 46, at + 46 + nameLength);
      at += 46 + nameLength + extraLength + commentLength;
      if (name.endsWith('/')) continue;
      if (method !== 0 || compressed !== uncompressed) throw new ZipReadError(`${name} is compressed; upload the ZIP as it was downloaded, or the .db file itself`);
      const local = readAt(fd, localOffset, 30);
      if (local.readUInt32LE(0) !== SIGNATURE_LOCAL_HEADER) throw new ZipReadError('The ZIP file is damaged');
      const dataOffset = localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      if (dataOffset + uncompressed > size) throw new ZipReadError('The ZIP file is cut off');
      entries.push({ name, crc, size: uncompressed, dataOffset });
    }
    return entries;
  } finally {
    fs.closeSync(fd);
  }
}

/** Copies one entry's bytes to `target`, checking its CRC-32. */
export function extractZipEntry(file: string, entry: ZipEntry, target: string): void {
  const input = fs.openSync(file, 'r');
  const output = fs.openSync(target, 'w', 0o600);
  try {
    const buf = Buffer.allocUnsafe(1 << 20);
    let crc = 0;
    let done = 0;
    while (done < entry.size) {
      const n = fs.readSync(input, buf, 0, Math.min(buf.length, entry.size - done), entry.dataOffset + done);
      if (n <= 0) throw new ZipReadError('The ZIP file is cut off');
      crc = crc32(buf.subarray(0, n), crc);
      fs.writeSync(output, buf, 0, n);
      done += n;
    }
    if (crc !== entry.crc) throw new ZipReadError(`${entry.name} is damaged (checksum mismatch)`);
  } finally {
    fs.closeSync(input);
    fs.closeSync(output);
  }
}
