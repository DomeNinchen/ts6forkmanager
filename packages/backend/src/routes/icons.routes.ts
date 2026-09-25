import { Router, Request, Response } from 'express';
import multer from 'multer';
import { requireRole } from '../middleware/rbac.js';
import { AppError, TSApiError } from '../middleware/error-handler.js';
import { normalizeIconId, type IconUsageMap, type IconUsageRef, type ServerIcon } from '@ts6/common';
import { sshExecute, toSshAppError } from '../utils/ssh-query.js';
import { crc32 } from '../utils/crc32.js';
import { ftDownloadBytes, ftUploadBytes, resolveFileTransferHost } from '../ts-client/file-transfer.js';
import type { ConnectionPool } from '../ts-client/connection-pool.js';
import type { PrismaClient } from '../generated/prisma/client.js';

export const iconRoutes: Router = Router({ mergeParams: true });

// A virtual server's icon pool is its own file repository (cid=0). Uploads and
// downloads address an icon at the repository root as `/icon_<id>`, while
// `ftgetfilelist` shows the very same files inside a virtual `/icons` folder -
// both confirmed against a real TeamSpeak 6 server.
const ICON_DIR = '/icons';
const ICON_CID = 0;
const iconPath = (iconId: number) => `/icon_${iconId}`;

// `clientftfid` only has to be unique among this process's own *currently
// pending* transfers on a given SSH connection - TeamSpeak uses it purely to
// echo back which request a ticket belongs to. `Date.now()`-based values are
// not safe here: two requests issued within the same millisecond (which the
// icon grid's parallel image fetches make routine) reuse the same id, and a
// real TS6 server then answers with a generic "convert error" (code 1540)
// instead of a normal ticket - confirmed against a live server. A simple
// wrapping counter guarantees distinct ids regardless of request timing.
let nextClientFtfid = 1;
function allocateClientFtfid(): number {
  const id = nextClientFtfid;
  nextClientFtfid = nextClientFtfid >= 0xffff ? 1 : nextClientFtfid + 1;
  return id;
}

// Hard ceiling for the multipart parser only. The limit that actually decides
// what may be uploaded is the server's own `i_max_icon_filesize` permission,
// checked below - this just stops someone streaming a huge file into memory
// before we ever get to ask the server.
const UPLOAD_HARD_LIMIT = 2 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_HARD_LIMIT, files: 1 },
});

const getSid = (req: Request) => parseInt(String(req.params.sid));
const getConfigId = (req: Request) => parseInt(String(req.params.configId));
const getClient = (req: Request) => {
  const pool: ConnectionPool = req.app.locals.connectionPool;
  return pool.getClient(getConfigId(req));
};

async function getServerHost(req: Request): Promise<string> {
  const prisma: PrismaClient = req.app.locals.prisma;
  const config = await prisma.tsServerConfig.findUnique({
    where: { id: getConfigId(req) },
    select: { host: true },
  });
  if (!config) throw new AppError(404, 'Server config not found');
  return config.host;
}

/** Read one integer permission value for the query identity this app connects
 * with. `permget` only ever reports the *caller's* own effective value - which
 * is exactly what matters here, since that same identity performs the upload. */
async function getPermissionValue(req: Request, permsid: string): Promise<number | null> {
  try {
    const rows = await sshExecute(req, 'permget', { permsid });
    const value = rows[0]?.permvalue;
    return value === undefined ? null : parseInt(value, 10);
  } catch {
    return null;
  }
}

function parseIconEntry(row: Record<string, string>): ServerIcon | null {
  const match = /^icon_(\d+)$/.exec(row.name || '');
  // type=1 is a file, type=0 a directory (per the ftgetfilelist docs and
  // confirmed live) - the `/icons` listing should only ever contain files.
  if (!match || row.type === '0') return null;
  return {
    iconId: Number(match[1]),
    name: row.name,
    size: Number(row.size) || 0,
    datetime: Number(row.datetime) || 0,
  };
}

async function listIcons(req: Request): Promise<ServerIcon[]> {
  try {
    const rows = await sshExecute(req, 'ftgetfilelist', { cid: ICON_CID, cpw: '', path: ICON_DIR });
    return rows
      .map(parseIconEntry)
      .filter((icon): icon is ServerIcon => icon !== null)
      .sort((a, b) => b.datetime - a.datetime);
  } catch (err: any) {
    // 1281 = database_empty_result → the pool simply has no icons yet
    if (err instanceof TSApiError && err.code === 1281) return [];
    throw err;
  }
}

/** Sniff the image type from the file's own bytes. The uploaded bytes are
 * stored verbatim, so a wrong `Content-Type` header is the only way the
 * browser could end up unable to render an icon it received correctly. */
function detectImageType(data: Buffer): string | null {
  if (data.length >= 8 && data.readUInt32BE(0) === 0x89504e47) return 'image/png';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.length >= 6 && data.subarray(0, 6).toString('latin1').startsWith('GIF8')) return 'image/gif';
  if (data.length >= 12 && data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  const head = data.subarray(0, 512).toString('utf8').replace(/^﻿/, '').trimStart();
  if (head.startsWith('<?xml') || head.startsWith('<svg')) return 'image/svg+xml';
  return null;
}

// List the icon pool, plus the limits the server itself imposes on uploads.
iconRoutes.get('/', async (req: Request, res: Response, next) => {
  try {
    const icons = await listIcons(req);
    const [maxFileSize, canManage] = await Promise.all([
      getPermissionValue(req, 'i_max_icon_filesize'),
      getPermissionValue(req, 'b_icon_manage'),
    ]);
    res.json({ icons, maxFileSize, canManage: canManage === null ? true : canManage === 1 });
  } catch (err) {
    next(toSshAppError(err));
  }
});

// Where each icon is currently assigned. All four sources are plain
// request/response commands, so this runs over WebQuery and works even while
// the icon images themselves (SSH-only) are unavailable.
iconRoutes.get('/usage', async (req: Request, res: Response, next) => {
  try {
    const client = getClient(req);
    const sid = getSid(req);
    const [server, serverGroups, channelGroups, channels] = await Promise.all([
      client.execute(sid, 'serverinfo'),
      client.execute(sid, 'servergrouplist'),
      client.execute(sid, 'channelgrouplist'),
      client.execute(sid, 'channellist', { '-icon': '' }),
    ]);

    const usage: IconUsageMap = {};
    const add = (rawIconId: any, ref: IconUsageRef) => {
      const iconId = normalizeIconId(rawIconId);
      if (!iconId) return;
      (usage[iconId] ||= []).push(ref);
    };

    const serverInfo = Array.isArray(server) ? server[0] : server;
    add(serverInfo?.virtualserver_icon_id, {
      kind: 'virtualserver',
      name: serverInfo?.virtualserver_name || 'Virtual Server',
    });
    for (const group of asArray(serverGroups)) {
      add(group.iconid, { kind: 'servergroup', id: Number(group.sgid), name: group.name });
    }
    for (const group of asArray(channelGroups)) {
      add(group.iconid, { kind: 'channelgroup', id: Number(group.cgid), name: group.name });
    }
    for (const channel of asArray(channels)) {
      add(channel.channel_icon_id, { kind: 'channel', id: Number(channel.cid), name: channel.channel_name });
    }

    res.json(usage);
  } catch (err) { next(err); }
});

// The icon image itself. Icon IDs are content hashes, so a given ID always
// refers to the same bytes and the response can be cached indefinitely.
iconRoutes.get('/:iconId/image', async (req: Request, res: Response, next) => {
  try {
    const iconId = parseInt(String(req.params.iconId), 10);
    if (!Number.isFinite(iconId) || iconId <= 0) throw new AppError(400, 'Invalid icon ID');

    const rows = await sshExecute(req, 'ftinitdownload', {
      clientftfid: allocateClientFtfid(),
      name: iconPath(iconId),
      cid: ICON_CID,
      cpw: '',
      seekpos: 0,
    });
    const ticket = rows[0];
    if (!ticket?.ftkey || !ticket.port) throw new AppError(502, 'Server did not return a file transfer ticket');

    const host = resolveFileTransferHost(ticket.ip, await getServerHost(req));
    const data = await ftDownloadBytes(host, Number(ticket.port), ticket.ftkey, Number(ticket.size) || 0);

    res.setHeader('Content-Type', detectImageType(data) || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.send(data);
  } catch (err: any) {
    // 1538 = invalid file path / not found
    if (err instanceof TSApiError && (err.code === 1538 || err.code === 1281)) {
      return next(new AppError(404, 'Icon not found in this server\'s icon pool'));
    }
    next(toSshAppError(err));
  }
});

iconRoutes.post('/', requireRole('admin'), upload.single('file'), async (req: Request, res: Response, next) => {
  try {
    const file = req.file;
    if (!file) throw new AppError(400, 'No file uploaded');

    const mimeType = detectImageType(file.buffer);
    if (!mimeType) {
      throw new AppError(400, 'Unsupported file type. Icons must be PNG, JPEG, GIF, WebP or SVG images.');
    }

    const maxFileSize = await getPermissionValue(req, 'i_max_icon_filesize');
    if (maxFileSize && file.buffer.length > maxFileSize) {
      throw new AppError(
        400,
        `Icon is too large: ${file.buffer.length} bytes, but this server allows at most ${maxFileSize} bytes (i_max_icon_filesize).`,
      );
    }

    const iconId = crc32(file.buffer);

    // Same bytes → same CRC32 → same icon. Re-uploading is harmless but
    // pointless, and the UI can say so instead of showing a new entry.
    const existing = await listIcons(req);
    if (existing.some((icon) => icon.iconId === iconId)) {
      return res.status(200).json({ iconId, alreadyExisted: true });
    }

    const rows = await sshExecute(req, 'ftinitupload', {
      clientftfid: allocateClientFtfid(),
      name: iconPath(iconId),
      cid: ICON_CID,
      cpw: '',
      size: file.buffer.length,
      overwrite: 1,
      resume: 0,
    });
    const ticket = rows[0];
    if (!ticket?.ftkey || !ticket.port) throw new AppError(502, 'Server did not return a file transfer ticket');

    const host = resolveFileTransferHost(ticket.ip, await getServerHost(req));
    const seekpos = Number(ticket.seekpos) || 0;
    await ftUploadBytes(host, Number(ticket.port), ticket.ftkey, file.buffer.subarray(seekpos));

    res.status(201).json({ iconId, alreadyExisted: false });
  } catch (err) {
    next(toSshAppError(err));
  }
});

// Bulk delete - registered before the generic /:iconId route, since Express
// would otherwise match "/bulk/delete" as "/:iconId" with iconId="bulk".
iconRoutes.post('/bulk/delete', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const { iconIds } = req.body as { iconIds: number[] };
    if (!Array.isArray(iconIds) || iconIds.length === 0) {
      throw new AppError(400, 'iconIds must be a non-empty array');
    }
    const results = await Promise.allSettled(
      iconIds.map((iconId) =>
        sshExecute(req, 'ftdeletefile', { cid: ICON_CID, cpw: '', name: iconPath(Number(iconId)) }),
      ),
    );
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    if (rejected.length === iconIds.length) throw toSshAppError(rejected[0].reason);
    res.json({ succeeded: iconIds.length - rejected.length, failed: rejected.length });
  } catch (err) {
    next(toSshAppError(err));
  }
});

iconRoutes.delete('/:iconId', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const iconId = parseInt(String(req.params.iconId), 10);
    if (!Number.isFinite(iconId) || iconId <= 0) throw new AppError(400, 'Invalid icon ID');
    await sshExecute(req, 'ftdeletefile', { cid: ICON_CID, cpw: '', name: iconPath(iconId) });
    res.json({ success: true });
  } catch (err) {
    next(toSshAppError(err));
  }
});

function asArray(result: any): Record<string, any>[] {
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}
