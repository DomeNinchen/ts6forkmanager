// A streaming ZIP writer for the Files page's "download a folder".
//
// The archive is written in one pass, front to back, straight into the HTTP
// response, so a folder of any size costs a few kilobytes of memory:
//
//  - Files are STORED, not compressed. A channel's repository is mostly pictures,
//    video and archives that do not shrink, and nothing here should burn CPU for it.
//  - Each file's CRC-32 and size are only known once its bytes have gone by, so the
//    local header leaves them at zero and a "data descriptor" after the data carries
//    them (general purpose flag bit 3). The central directory at the end has them
//    too, which is what every common unzip tool reads.
//  - Names are UTF-8 (flag bit 11).
//  - No ZIP64: a folder of more than 65,534 entries or 4 GiB is refused up front
//    (see `archiveSize`) instead of being written as a corrupt archive. 0xFFFF and
//    0xFFFFFFFF are the values that announce ZIP64 to a reader, so the limits sit
//    one below them.

import { crc32 } from 'node:zlib';
import { Writable } from 'node:stream';

const SIGNATURE_LOCAL_HEADER = 0x04034b50;
const SIGNATURE_DATA_DESCRIPTOR = 0x08074b50;
const SIGNATURE_CENTRAL_HEADER = 0x02014b50;
const SIGNATURE_END_OF_CENTRAL_DIRECTORY = 0x06054b50;

const FLAG_DATA_DESCRIPTOR = 0x0008;
const FLAG_UTF8 = 0x0800;

const VERSION_NEEDED = 20; // 2.0: data descriptors, folders
const VERSION_MADE_BY = (3 << 8) | 20; // "Unix", 2.0 - so the permission bits below mean something

const UNIX_FILE = (0o100644 << 16) >>> 0;
const UNIX_DIRECTORY = ((0o40755 << 16) | 0x10) >>> 0; // 0x10: the DOS "directory" attribute

const LOCAL_HEADER_BYTES = 30;
const DATA_DESCRIPTOR_BYTES = 16;
const CENTRAL_HEADER_BYTES = 46;
const END_OF_CENTRAL_DIRECTORY_BYTES = 22;

/** Most entries (files and folders) one archive can hold without ZIP64. */
export const ZIP_MAX_ENTRIES = 0xfffe;
/** Largest archive, in bytes, without ZIP64. */
export const ZIP_MAX_BYTES = 0xfffffffe;

/** What a ZIP written by this module cannot hold. */
export class ZipLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipLimitError';
  }
}

export interface ZipEntrySize {
  /** The name as it goes into the archive (folders end in a slash). */
  name: string;
  /** Bytes of data; 0 for a folder. */
  size: number;
  isDirectory: boolean;
}

/**
 * How many bytes the archive of these entries will be, to the byte - the figure
 * for `Content-Length`. Throws {@link ZipLimitError} if it does not fit in a ZIP
 * without ZIP64.
 */
export function archiveSize(entries: ZipEntrySize[]): number {
  if (entries.length > ZIP_MAX_ENTRIES) {
    throw new ZipLimitError(`${entries.length} entries, at most ${ZIP_MAX_ENTRIES} fit in a ZIP`);
  }
  let total = END_OF_CENTRAL_DIRECTORY_BYTES;
  for (const entry of entries) {
    const name = Buffer.byteLength(entry.name, 'utf8');
    if (name > 0xffff) throw new ZipLimitError('A name is too long for a ZIP');
    total += LOCAL_HEADER_BYTES + name + CENTRAL_HEADER_BYTES + name;
    if (!entry.isDirectory) total += entry.size + DATA_DESCRIPTOR_BYTES;
    if (total > ZIP_MAX_BYTES) throw new ZipLimitError(`More than ${ZIP_MAX_BYTES} bytes, the most a ZIP without ZIP64 holds`);
  }
  return total;
}

/** DOS date and time of a timestamp (UTC; the format has no time zone). Anything
 * before 1980, the start of the format, or without a timestamp, becomes 1980-01-01. */
export function dosDateTime(milliseconds: number): { date: number; time: number } {
  const moment = new Date(milliseconds > 0 ? milliseconds : 0);
  const year = moment.getUTCFullYear();
  if (!(year >= 1980)) return { date: (1 << 5) | 1, time: 0 };
  return {
    date: ((Math.min(year, 2107) - 1980) << 9) | ((moment.getUTCMonth() + 1) << 5) | moment.getUTCDate(),
    time: (moment.getUTCHours() << 11) | (moment.getUTCMinutes() << 5) | (moment.getUTCSeconds() >> 1),
  };
}

interface CentralRecord {
  name: Buffer;
  flags: number;
  date: number;
  time: number;
  crc: number;
  size: number;
  externalAttributes: number;
  localHeaderOffset: number;
}

/**
 * Writes one ZIP into `output`. Add entries one after the other - a file's bytes
 * are written while `source` runs - and finish with {@link finish}.
 */
export class ZipWriter {
  private offset = 0;
  private readonly records: CentralRecord[] = [];

  constructor(private readonly output: Writable) {}

  /** Bytes written so far. */
  get written(): number {
    return this.offset;
  }

  private emit(chunk: Buffer): Promise<void> {
    this.offset += chunk.length;
    return new Promise((resolve, reject) => {
      if (this.output.destroyed || this.output.writableEnded) {
        reject(new Error('The ZIP stream is closed'));
        return;
      }
      // The callback comes once the chunk has been taken, so awaiting it is the backpressure
      this.output.write(chunk, (err) => (err ? reject(err) : resolve()));
    });
  }

  private checkRoom(additionalBytes: number) {
    if (this.records.length >= ZIP_MAX_ENTRIES) throw new ZipLimitError(`More than ${ZIP_MAX_ENTRIES} entries`);
    if (this.offset + additionalBytes > ZIP_MAX_BYTES) throw new ZipLimitError('The archive grew past what a ZIP without ZIP64 holds');
  }

  private localHeader(name: Buffer, flags: number, date: number, time: number): Buffer {
    const header = Buffer.alloc(LOCAL_HEADER_BYTES + name.length);
    header.writeUInt32LE(SIGNATURE_LOCAL_HEADER, 0);
    header.writeUInt16LE(VERSION_NEEDED, 4);
    header.writeUInt16LE(flags, 6);
    header.writeUInt16LE(0, 8); // method 0: stored
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    // CRC-32 and both sizes stay 0: the data descriptor (or, for a folder, nothing) has them
    header.writeUInt16LE(name.length, 26);
    // extra field length (28) stays 0
    name.copy(header, LOCAL_HEADER_BYTES);
    return header;
  }

  /** A folder. `name` ends in a slash. */
  async addDirectory(name: string, modified: number): Promise<void> {
    const encoded = Buffer.from(name, 'utf8');
    this.checkRoom(LOCAL_HEADER_BYTES + encoded.length);
    const { date, time } = dosDateTime(modified);
    const record: CentralRecord = {
      name: encoded, flags: FLAG_UTF8, date, time, crc: 0, size: 0,
      externalAttributes: UNIX_DIRECTORY, localHeaderOffset: this.offset,
    };
    await this.emit(this.localHeader(encoded, FLAG_UTF8, date, time));
    this.records.push(record);
  }

  /**
   * A file of exactly `size` bytes. `source` is handed a writable to put them into
   * and settles once it has ended it - `ftDownloadStream` does exactly that. Anything
   * but `size` bytes is an error: the archive's size was announced up front, and a
   * file that changed in the meantime must not be written as if it had not.
   */
  async addFile(name: string, size: number, modified: number, source: (sink: Writable) => Promise<void>): Promise<void> {
    const encoded = Buffer.from(name, 'utf8');
    this.checkRoom(LOCAL_HEADER_BYTES + encoded.length + size + DATA_DESCRIPTOR_BYTES);
    const { date, time } = dosDateTime(modified);
    const flags = FLAG_UTF8 | FLAG_DATA_DESCRIPTOR;
    const localHeaderOffset = this.offset;
    await this.emit(this.localHeader(encoded, flags, date, time));

    let crc = 0;
    let received = 0;
    const sink = new Writable({
      write: (chunk: Buffer, _encoding, callback) => {
        received += chunk.length;
        if (received > size) return callback(new Error(`${name} is larger than the announced ${size} bytes`));
        crc = crc32(chunk, crc);
        this.emit(chunk).then(() => callback(), callback);
      },
    });
    await source(sink);
    if (received !== size) throw new Error(`${name} came to ${received} bytes, not the announced ${size}`);

    const descriptor = Buffer.alloc(DATA_DESCRIPTOR_BYTES);
    descriptor.writeUInt32LE(SIGNATURE_DATA_DESCRIPTOR, 0);
    descriptor.writeUInt32LE(crc, 4);
    descriptor.writeUInt32LE(size, 8); // compressed size: the same, nothing is compressed
    descriptor.writeUInt32LE(size, 12);
    await this.emit(descriptor);
    this.records.push({ name: encoded, flags, date, time, crc, size, externalAttributes: UNIX_FILE, localHeaderOffset });
  }

  /** The central directory, the end record, and the end of the stream. */
  async finish(): Promise<void> {
    const centralStart = this.offset;
    const parts: Buffer[] = [];
    for (const record of this.records) {
      const header = Buffer.alloc(CENTRAL_HEADER_BYTES + record.name.length);
      header.writeUInt32LE(SIGNATURE_CENTRAL_HEADER, 0);
      header.writeUInt16LE(VERSION_MADE_BY, 4);
      header.writeUInt16LE(VERSION_NEEDED, 6);
      header.writeUInt16LE(record.flags, 8);
      header.writeUInt16LE(0, 10); // method: stored
      header.writeUInt16LE(record.time, 12);
      header.writeUInt16LE(record.date, 14);
      header.writeUInt32LE(record.crc, 16);
      header.writeUInt32LE(record.size, 20);
      header.writeUInt32LE(record.size, 24);
      header.writeUInt16LE(record.name.length, 28);
      // extra field (30), comment (32), disk number (34), internal attributes (36): 0
      header.writeUInt32LE(record.externalAttributes, 38);
      header.writeUInt32LE(record.localHeaderOffset, 42);
      record.name.copy(header, CENTRAL_HEADER_BYTES);
      parts.push(header);
    }
    const central = Buffer.concat(parts);
    if (centralStart + central.length + END_OF_CENTRAL_DIRECTORY_BYTES > ZIP_MAX_BYTES) {
      throw new ZipLimitError('The archive grew past what a ZIP without ZIP64 holds');
    }
    await this.emit(central);

    const end = Buffer.alloc(END_OF_CENTRAL_DIRECTORY_BYTES);
    end.writeUInt32LE(SIGNATURE_END_OF_CENTRAL_DIRECTORY, 0);
    end.writeUInt16LE(this.records.length, 8); // entries on this disk
    end.writeUInt16LE(this.records.length, 10); // entries in all
    end.writeUInt32LE(central.length, 12);
    end.writeUInt32LE(centralStart, 16);
    await this.emit(end);

    await new Promise<void>((resolve, reject) => {
      this.output.once('error', reject);
      this.output.end(() => resolve());
    });
  }
}
