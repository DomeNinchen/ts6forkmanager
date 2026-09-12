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
import * as crypto from 'crypto';
import { buildCommand } from './commands.js';
import type { Ts3Client } from './client.js';

let ftfidCounter = 1;

/** The special file name TS3 uses for a client's own avatar, in the cid=0 (server-wide) file repository. */
export const AVATAR_FILE_NAME = '/avatar';

/** parseCommand() takes the first whitespace-separated token as the command
 * "name" - correct for a real named reply/notification, but if the server
 * instead sends a bare, name-less data line (first token being the first
 * key=value pair rather than a keyword), that pair silently isn't in
 * `params` at all - it got consumed as `name` instead. Recover clientftfid
 * from `name` in that shape too, so matching doesn't depend on which of the
 * two ever turns out to be the real one. */
function extractClientFtfid(parsed: { name: string; params: Record<string, string> }): string | undefined {
  if (parsed.params.clientftfid !== undefined) return parsed.params.clientftfid;
  const m = parsed.name.match(/^clientftfid=(\d+)$/);
  return m ? m[1] : undefined;
}

async function ftInitUpload(
  client: Ts3Client,
  name: string,
  size: number,
  timeoutMs: number
): Promise<{ port: number; ftkey: string; seekpos: number }> {
  const clientftfid = ftfidCounter++;

  return new Promise((resolve, reject) => {
    const seen: string[] = [];
    const timer = setTimeout(() => {
      client.off('command', onCommand);
      reject(new Error(
        `ftinitupload (clientftfid=${clientftfid}) timed out waiting for a server response. ` +
        `Commands seen while waiting: ${seen.length ? seen.join(' | ') : '(none)'}`
      ));
    }, timeoutMs);

    const onCommand = (parsed: { name: string; params: Record<string, string> }) => {
      seen.push(`${parsed.name} ${JSON.stringify(parsed.params)}`.slice(0, 200));
      if (extractClientFtfid(parsed) !== String(clientftfid)) return;
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
      console.log(`[filetransfer] ftinitupload resolved: port=${port} seekpos=${seekpos}`);
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

/** Upload `data` as this client's own avatar. `host` is the file-transfer host
 * (same as the voice server host). Uploading the file alone isn't enough -
 * other clients only know to fetch it once `client_flag_avatar` is set to
 * the file's MD5 hash (confirmed against a real TS6 test server; this step
 * isn't in any official ftinitupload docs, it's what the real client does). */
export async function uploadAvatar(client: Ts3Client, host: string, data: Buffer, timeoutMs = 15000): Promise<void> {
  console.log(`[filetransfer] Uploading avatar (${data.length} bytes) to ${host}`);
  const { port, ftkey, seekpos } = await ftInitUpload(client, AVATAR_FILE_NAME, data.length, timeoutMs);
  await ftUploadBytes(host, port, ftkey, data.subarray(seekpos), timeoutMs);
  const md5 = crypto.createHash('md5').update(data).digest('hex');
  client.sendCommand(buildCommand('clientupdate', { client_flag_avatar: md5 }));
  console.log(`[filetransfer] Avatar upload to ${host}:${port} completed, flag set (md5=${md5})`);
}

/** Remove this client's own avatar server-side (best-effort; the server may
 * reply with an error if none is set) and clear the flag so other clients
 * stop showing the old one. */
export function deleteAvatar(client: Ts3Client): void {
  client.sendCommand(buildCommand('ftdeletefile', { cid: 0, cpw: '', name: AVATAR_FILE_NAME }));
  client.sendCommand(buildCommand('clientupdate', { client_flag_avatar: '' }));
}
