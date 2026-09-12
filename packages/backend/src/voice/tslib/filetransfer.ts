// TS3 avatar upload over the file-transfer protocol.
//
// Flow (verified against py-ts3's filetransfer module and TeamSpeak forum
// reports of the real wire format, no live server available to test against
// in this sandbox - see README):
//   1. Send `ftinitupload` on the existing voice/command connection (UDP).
//      The server replies with clientftfid/serverftfid/ftkey/port/seekpos.
//   2. Open a *separate* raw TCP connection to that port.
//   3. Write the ftkey, then the raw file bytes (from seekpos onward) - no
//      other framing.
//
// The reply to ftinitupload isn't guaranteed to arrive as its own named
// command vs. merged onto the trailing `error id=0 ...` completion line
// (both are observed shapes for TS3's query-style responses depending on
// version), so we match on `clientftfid` in every parsed command instead of
// relying on a specific command name.
import * as net from 'net';
import { buildCommand } from './commands.js';
import type { Ts3Client } from './client.js';

let ftfidCounter = 1;

/** The special file name TS3 uses for a client's own avatar, in the cid=0 (server-wide) file repository. */
export const AVATAR_FILE_NAME = '/avatar';

async function ftInitUpload(
  client: Ts3Client,
  name: string,
  size: number,
  timeoutMs: number
): Promise<{ port: number; ftkey: string; seekpos: number }> {
  const clientftfid = ftfidCounter++;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off('command', onCommand);
      reject(new Error('ftinitupload timed out waiting for a server response'));
    }, timeoutMs);

    const onCommand = (parsed: { name: string; params: Record<string, string> }) => {
      if (parsed.params.clientftfid !== String(clientftfid)) return;
      clearTimeout(timer);
      client.off('command', onCommand);

      const errId = parseInt(parsed.params.id || '0', 10);
      if (parsed.name === 'error' && errId !== 0) {
        reject(new Error(`ftinitupload failed: TS3 error ${errId}: ${parsed.params.msg || 'unknown error'}`));
        return;
      }

      const port = parseInt(parsed.params.port || '0', 10);
      const ftkey = parsed.params.ftkey;
      const seekpos = parseInt(parsed.params.seekpos || '0', 10) || 0;
      if (!port || !ftkey) {
        reject(new Error(`ftinitupload did not return a usable port/ftkey (got: ${JSON.stringify(parsed.params)})`));
        return;
      }
      resolve({ port, ftkey, seekpos });
    };

    client.on('command', onCommand);
    client.sendCommand(buildCommand('ftinitupload', {
      clientftfid,
      name,
      cid: 0,
      cpw: '',
      size,
      overwrite: 1,
      resume: 0,
    }));
  });
}

function ftUploadBytes(host: string, port: number, ftkey: string, data: Buffer, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      socket.write(ftkey, () => {
        socket.end(data);
      });
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('File transfer connection timed out'));
    });
    socket.once('error', reject);
    socket.once('close', (hadError) => {
      if (!hadError) resolve();
    });
  });
}

/** Upload `data` as this client's own avatar. `host` is the file-transfer host (same as the voice server host). */
export async function uploadAvatar(client: Ts3Client, host: string, data: Buffer, timeoutMs = 15000): Promise<void> {
  const { port, ftkey, seekpos } = await ftInitUpload(client, AVATAR_FILE_NAME, data.length, timeoutMs);
  await ftUploadBytes(host, port, ftkey, data.subarray(seekpos), timeoutMs);
}

/** Remove this client's own avatar server-side (best-effort; the server may reply with an error if none is set). */
export function deleteAvatar(client: Ts3Client): void {
  client.sendCommand(buildCommand('ftdeletefile', { cid: 0, cpw: '', name: AVATAR_FILE_NAME }));
}
