import net from 'net';
import { Transform, type Readable, type Writable } from 'stream';

// Raw TeamSpeak file-transfer client for ServerQuery-initiated transfers.
//
// `ftinitdownload`/`ftinitupload` only hand out a ticket (an `ftkey`, a port
// and - for downloads - the file size); the bytes themselves travel over a
// separate plain TCP connection to the server's file-transfer port (30033 by
// default). The protocol on that socket is: send the 32-character ftkey, then
// either stream the file's bytes (upload) or read `size` bytes (download).
//
// Verified end-to-end against a real TeamSpeak 6 server: an icon uploaded this
// way shows up in `ftgetfilelist`, and downloading it again returns bytes
// identical to the original file.
//
// Two flavours live here: `ftUploadBytes`/`ftDownloadBytes` hold a whole file
// in memory (fine for icons, a few KB), while `ftUploadStream`/`ftDownloadStream`
// move a file of any size through with constant memory, for the Files page.
//
// This is deliberately separate from `voice/tslib/filetransfer.ts`, which does
// the same dance over the *client* protocol for music-bot avatars.

const DEFAULT_TIMEOUT_MS = 20000;

/** How long a streamed transfer may go without a single byte moving before it
 * is given up on. Longer than the buffered flavour's, because a browser
 * upload behind a slow uplink can pause for a while between chunks. */
const STREAM_IDLE_TIMEOUT_MS = 60000;

// `clientftfid` only has to be unique among this process's own *currently
// pending* transfers on a given SSH connection - TeamSpeak uses it purely to
// echo back which request a ticket belongs to. `Date.now()`-based values are
// not safe here: two requests issued within the same millisecond (which the
// icon grid's parallel image fetches make routine) reuse the same id, and a
// real TS6 server then answers with a generic "convert error" (code 1540)
// instead of a normal ticket - confirmed against a live server. A simple
// wrapping counter guarantees distinct ids regardless of request timing.
//
// One counter for every caller (icons, the Files page): they all share the same
// SSH connection per virtual server, so separate counters could hand out the
// same id to two transfers that are pending at once.
let nextClientFtfid = 1;
export function allocateClientFtfid(): number {
  const id = nextClientFtfid;
  nextClientFtfid = nextClientFtfid >= 0xffff ? 1 : nextClientFtfid + 1;
  return id;
}

/** `ftinit*` may answer with an `ip` parameter when the server thinks its
 * file-transfer subsystem is not reachable under the address the query
 * connection is using. A wildcard bind (`0.0.0.0`, `::`) tells us nothing, so
 * in that case we stay with the host the server config already points at. */
export function resolveFileTransferHost(reportedIp: string | undefined, fallbackHost: string): string {
  if (!reportedIp) return fallbackHost;
  for (const candidate of reportedIp.split(',')) {
    const ip = candidate.trim();
    if (!ip || ip === '0.0.0.0' || ip === '::' || ip === '0::0') continue;
    return ip;
  }
  return fallbackHost;
}

/** What `ftinitupload`/`ftinitdownload` hand back once they accept a transfer. */
export interface FtTicket {
  ftkey: string;
  port: number;
  /** Bytes the download will deliver; not part of an upload answer (0 there). */
  size: number;
  /** Byte offset an upload has to continue from (0 unless resuming). */
  seekpos: number;
  serverftfid: number;
  /** The server's own idea of where its transfer port can be reached, if it sent one. */
  ip?: string;
}

/** The server refused to start a transfer. `status` is TeamSpeak's own error
 * number (2050 "file already exists", 2051 "file not found", 2048 "invalid file
 * name", 2054 "invalid file path", 2052 "file input/output error" - all seen
 * live), or 0 when the answer carried no ticket and no status at all. */
export class FtInitError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'FtInitError';
  }
}

/**
 * Read the answer to `ftinitupload`/`ftinitdownload`. A refusal does not arrive
 * as an `error id=...` line, which the SSH layer would turn into an exception:
 * the command *succeeds* and the row carries `status=` and `msg=` instead of a
 * ticket (`clientftfid=3 status=2050 msg=file\salready\sexists size=12`,
 * verified against a real TS6 server). Without this check a refusal looks like
 * an answer that merely lacks a port.
 */
export function parseFtTicket(rows: Record<string, string>[]): FtTicket {
  const row = rows[0];
  if (row && !row.ftkey && row.status !== undefined) {
    throw new FtInitError(Number(row.status) || 0, row.msg || 'The server refused the file transfer');
  }
  const port = Number(row?.port);
  if (!row?.ftkey || !Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new FtInitError(0, 'The server did not return a file transfer ticket');
  }
  return {
    ftkey: row.ftkey,
    port,
    size: Number(row.size) || 0,
    seekpos: Number(row.seekpos) || 0,
    serverftfid: Number(row.serverftfid) || 0,
    ip: row.ip,
  };
}

export function ftUploadBytes(
  host: string,
  port: number,
  ftkey: string,
  data: Buffer,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      socket.write(ftkey, () => socket.end(data));
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error(`File transfer to ${host}:${port} timed out`));
    });
    socket.once('error', reject);
    socket.once('close', (hadError) => {
      if (!hadError) resolve();
    });
  });
}

export function ftDownloadBytes(
  host: string,
  port: number,
  ftkey: string,
  size: number,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    let settled = false;

    const socket = net.createConnection({ host, port });
    socket.setTimeout(timeoutMs);

    const finish = (err: Error | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve(Buffer.concat(chunks));
    };

    socket.once('connect', () => socket.write(ftkey));
    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      received += chunk.length;
      if (received >= size) finish(null);
    });
    socket.once('timeout', () => finish(new Error(`File transfer from ${host}:${port} timed out`)));
    socket.once('error', (err) => finish(err));
    socket.once('close', () => {
      // A clean close before `size` bytes arrived means the server cut the
      // transfer short - report that instead of handing back a truncated file.
      if (received < size) finish(new Error(`File transfer ended early (${received}/${size} bytes)`));
      else finish(null);
    });
  });
}

/**
 * Stream exactly `size` bytes from `source` (typically the incoming HTTP
 * request) to the server's transfer port, with constant memory.
 *
 * Resolves once the server has taken all the bytes and closed the connection.
 * Rejects - and stops feeding the socket - if the source ends short or runs
 * over `size`, the client goes away mid-transfer, the server drops the
 * connection before the last byte, or nothing moves for `idleTimeoutMs`.
 *
 * `source` is only ever unpiped on failure, never destroyed: destroying an
 * incoming HTTP request would tear down the client's connection and with it the
 * chance to answer the client with an error message.
 */
export function ftUploadStream(
  host: string,
  port: number,
  ftkey: string,
  source: Readable,
  size: number,
  idleTimeoutMs = STREAM_IDLE_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(idleTimeoutMs);

    let sent = 0;
    let allWritten = false;
    let settled = false;

    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        sent += chunk.length;
        if (sent > size) callback(new Error(`Upload is larger than the announced ${size} bytes`));
        else callback(null, chunk);
      },
      flush(callback) {
        callback(sent === size ? null : new Error(`Upload ended after ${sent} of ${size} bytes`));
      },
    });

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      source.unpipe(counter);
      counter.destroy();
      socket.destroy();
      reject(err);
    };

    // The client vanished before sending everything (browser closed, transfer cancelled).
    // 'error' listeners stay attached for good (`on`, not `once`): an error
    // emitted after we have already given up must not surface as an uncaught exception.
    source.once('close', () => {
      if (!source.readableEnded) fail(new Error('The upload was interrupted before it finished'));
    });
    source.on('error', fail);
    counter.on('error', fail);

    socket.once('connect', () => {
      socket.write(ftkey, (err) => {
        if (err) return fail(err);
        source.pipe(counter).pipe(socket);
      });
    });
    socket.once('finish', () => {
      allWritten = true;
    });
    socket.once('timeout', () => fail(new Error(`File transfer to ${host}:${port} timed out`)));
    socket.on('error', fail);
    socket.once('close', () => {
      if (settled) return;
      settled = true;
      // The server closes once it has every byte. A close before we had
      // written the last one is a refusal or a crash, not a finished upload.
      if (allWritten) resolve();
      else reject(new Error(`The server closed the file transfer after ${sent} of ${size} bytes`));
    });
  });
}

/**
 * Stream a file of `size` bytes from the server's transfer port into
 * `destination` (typically the HTTP response), with constant memory and
 * backpressure in both directions.
 *
 * Resolves after the last byte has been handed to `destination` and it has been
 * ended. Rejects if the server delivers fewer than `size` bytes, the
 * destination closes early (the browser cancelled the download), or nothing
 * moves for `idleTimeoutMs`. The server does not necessarily close the
 * connection after `size` bytes, so the byte count - not the socket - decides
 * when the download is complete.
 */
export function ftDownloadStream(
  host: string,
  port: number,
  ftkey: string,
  size: number,
  destination: Writable,
  idleTimeoutMs = STREAM_IDLE_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(idleTimeoutMs);

    let received = 0;
    let settled = false;

    const finish = (err: Error | null) => {
      if (settled) return;
      settled = true;
      destination.off('close', onDestinationClose);
      socket.destroy();
      if (err) reject(err);
      else resolve();
    };

    const complete = () => {
      // Ending the destination is what flushes the last bytes to the client;
      // only then is the download really over.
      destination.end(() => finish(null));
    };

    const onDestinationClose = () => {
      if (!destination.writableFinished) finish(new Error('The client closed the connection before the download finished'));
    };
    // 'error' listeners stay attached for good (`on`, not `once`): an error
    // emitted after we have already finished must not surface as an uncaught exception.
    destination.once('close', onDestinationClose);
    destination.on('error', finish);

    socket.once('connect', () => {
      socket.write(ftkey);
      // A zero-byte file has nothing to read; the server just closes.
      if (size === 0) complete();
    });
    socket.on('data', (chunk: Buffer) => {
      if (settled || received >= size) return;
      const piece = received + chunk.length > size ? chunk.subarray(0, size - received) : chunk;
      received += piece.length;
      const flushed = destination.write(piece);
      if (received >= size) return complete();
      if (!flushed) {
        socket.pause();
        destination.once('drain', () => socket.resume());
      }
    });
    socket.once('timeout', () => finish(new Error(`File transfer from ${host}:${port} timed out`)));
    socket.on('error', finish);
    socket.once('close', () => {
      // A close before `size` bytes arrived means the server cut the transfer
      // short - report that instead of ending the response as if it were complete.
      if (received < size) finish(new Error(`File transfer ended early (${received}/${size} bytes)`));
    });
  });
}
