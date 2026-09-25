import net from 'net';

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
// This is deliberately separate from `voice/tslib/filetransfer.ts`, which does
// the same dance over the *client* protocol for music-bot avatars.

const DEFAULT_TIMEOUT_MS = 20000;

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
