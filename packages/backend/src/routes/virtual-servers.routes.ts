import { Router, Request, Response } from 'express';
import { requireRole, requirePermission } from '../middleware/rbac.js';
import { AppError, TSApiError } from '../middleware/error-handler.js';
import type { ConnectionPool } from '../ts-client/connection-pool.js';
import { grantCovers, grantOf } from '../utils/vs-access.js';
import { backupBeforeDeleting } from '../utils/bulk-backup.js';
import { cleanUpDeletedVirtualServer } from '../utils/virtual-server-cleanup.js';
import type { VirtualServerDeleteResult } from '@ts6/common';
import { backupsWithSnapshot, readBackupSnapshot } from '../utils/backups.js';
import { compareSnapshots, readSnapshot } from '../utils/ts-snapshot.js';
import type { SnapshotBackupSource, SnapshotCompareRequest, SnapshotCompareSource } from '@ts6/common';

export const virtualServerRoutes: Router = Router({ mergeParams: true });

const getClient = (req: Request) => {
  const pool: ConnectionPool = req.app.locals.connectionPool;
  return pool.getClient(parseInt(String(req.params.configId)));
};

// The mount's server-access check sees no sid here (it is this router's parameter), so a non-admin's
// grant is checked for every /:sid route, and the list only shows the virtual servers it covers.
virtualServerRoutes.param('sid', async (req: Request, _res: Response, next, sidParam) => {
  try {
    if (req.user!.role === 'admin') return next();
    const grant = await grantOf(req.app.locals.prisma, req.user!.id, parseInt(String(req.params.configId)));
    if (!/^[1-9]\d*$/.test(String(sidParam)) || !grantCovers(grant, Number(sidParam))) {
      return next(new AppError(403, 'No access to this virtual server'));
    }
    next();
  } catch (err) { next(err); }
});

virtualServerRoutes.get('/', async (req: Request, res: Response, next) => {
  try {
    const result = await getClient(req).execute(0, 'serverlist');
    if (req.user!.role === 'admin') return res.json(result);
    const grant = await grantOf(req.app.locals.prisma, req.user!.id, parseInt(String(req.params.configId)));
    res.json((Array.isArray(result) ? result : []).filter((s: { virtualserver_id?: unknown }) => grantCovers(grant, Number(s.virtualserver_id))));
  } catch (err) { next(err); }
});

// Only the admin pages (Statistics, Advanced Settings) read the full server
// info / connection info; the server list above is what every role needs.
virtualServerRoutes.get('/:sid/info', requirePermission('vserver.edit'), async (req: Request, res: Response, next) => {
  try {
    const sid = parseInt(String(req.params.sid));
    const result = await getClient(req).execute(sid, 'serverinfo');
    res.json(result);
  } catch (err) { next(err); }
});

// M3: Whitelist safe parameters for serveredit
export const ALLOWED_SERVER_EDIT_PARAMS = new Set([
  'virtualserver_name', 'virtualserver_welcomemessage', 'virtualserver_maxclients',
  'virtualserver_password', 'virtualserver_hostmessage', 'virtualserver_hostmessage_mode',
  'virtualserver_default_server_group', 'virtualserver_default_channel_group',
  'virtualserver_default_channel_admin_group', 'virtualserver_hostbanner_url',
  'virtualserver_hostbanner_gfx_url', 'virtualserver_hostbanner_gfx_interval',
  'virtualserver_hostbanner_mode', 'virtualserver_hostbutton_tooltip',
  'virtualserver_hostbutton_url', 'virtualserver_hostbutton_gfx_url',
  'virtualserver_icon_id', 'virtualserver_codec_encryption_mode',
  'virtualserver_needed_identity_security_level', 'virtualserver_min_client_version',
  'virtualserver_antiflood_points_tick_reduce', 'virtualserver_antiflood_points_needed_command_block',
  'virtualserver_antiflood_points_needed_ip_block', 'virtualserver_antiflood_points_needed_plugin_block',
  'virtualserver_log_client', 'virtualserver_log_query', 'virtualserver_log_channel',
  'virtualserver_log_permissions', 'virtualserver_log_server', 'virtualserver_log_filetransfer',
  'virtualserver_reserved_slots', 'virtualserver_weblist_enabled',
  'virtualserver_complain_autoban_count', 'virtualserver_complain_autoban_time', 'virtualserver_complain_remove_time',
  'virtualserver_min_clients_in_channel_before_forced_silence', 'virtualserver_priority_speaker_dimm_modificator',
  'virtualserver_download_quota', 'virtualserver_upload_quota',
  'virtualserver_max_download_total_bandwidth', 'virtualserver_max_upload_total_bandwidth',
]);

virtualServerRoutes.put('/:sid', requirePermission('vserver.edit'), async (req: Request, res: Response, next) => {
  try {
    const sid = parseInt(String(req.params.sid));
    const filtered: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(req.body)) {
      if (ALLOWED_SERVER_EDIT_PARAMS.has(key)) filtered[key] = val;
    }
    const result = await getClient(req).execute(sid, 'serveredit', filtered);
    res.json(result);
  } catch (err) { next(err); }
});

virtualServerRoutes.post('/', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const result = await getClient(req).execute(0, 'servercreate', req.body);
    res.status(201).json(result);
  } catch (err) { next(err); }
});

virtualServerRoutes.post('/:sid/start', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const sid = parseInt(String(req.params.sid));
    const result = await getClient(req).execute(0, 'serverstart', { sid });
    res.json(result);
  } catch (err) { next(err); }
});

virtualServerRoutes.post('/:sid/stop', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const sid = parseInt(String(req.params.sid));
    const result = await getClient(req).execute(0, 'serverstop', { sid });
    res.json(result);
  } catch (err) { next(err); }
});

const statusOf = async (client: ReturnType<typeof getClient>, sid: number): Promise<string | undefined> => {
  const list = await client.execute(0, 'serverlist');
  const vs = (Array.isArray(list) ? list : [list]).find((s: { virtualserver_id?: unknown }) => Number(s?.virtualserver_id) === sid);
  return vs ? String(vs.virtualserver_status) : undefined;
};

// TS6 deletes only a stopped server (measured: a running one answers 1035, an unknown sid 1024;
// sids are never handed out again). A stopped server that a query client touched (the bandwidth
// sampler, or the snapshot of the backup before this) is "online virtual": no voice clients, but TS6
// still answers 1035 until it is stopped again - so that one is stopped and retried once.
// Order: state check, backup, delete, then the manager's own data of that server (cleanUpDeletedVirtualServer).
virtualServerRoutes.delete('/:sid', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    if (!/^[1-9]\d*$/.test(String(req.params.sid))) throw new AppError(400, 'Invalid virtual server ID');
    const sid = Number(req.params.sid);
    const configId = Number(req.params.configId);
    const client = getClient(req);
    const status = await statusOf(client, sid);
    if (status === undefined) throw new TSApiError(1024, 'invalid serverID');
    if (status !== 'offline' && status !== 'online virtual') throw new TSApiError(1035, 'server got an invalid status for this operation');

    const backup = await backupBeforeDeleting(req, undefined, true);
    try {
      await client.execute(0, 'serverdelete', { sid });
    } catch (err) {
      if (!(err instanceof TSApiError && err.code === 1035) || (await statusOf(client, sid)) !== 'online virtual') throw err;
      await client.execute(0, 'serverstop', { sid });
      await client.execute(0, 'serverdelete', { sid });
    }

    const result: VirtualServerDeleteResult = { deleted: true, backup, cleanup: null };
    try {
      result.cleanup = await cleanUpDeletedVirtualServer({ prisma: req.app.locals.prisma, botEngine: req.app.locals.botEngine, raid: req.app.locals.raidProtection }, configId, sid);
    } catch (err) {
      // TeamSpeak has deleted the server already: say what is left instead of a failure.
      result.cleanupError = (err as Error).message;
      console.error(`[VirtualServers] Clean-up after deleting ${configId}/${sid} failed: ${result.cleanupError}`);
    }
    res.json(result);
  } catch (err) {
    if (err instanceof TSApiError && err.code === 1035) {
      return next(new AppError(409, 'Only a stopped virtual server can be deleted - stop it first', undefined, 'SERVER_RUNNING'));
    }
    if (err instanceof TSApiError && err.code === 1024) {
      return next(new AppError(404, 'This virtual server does not exist (any more)', undefined, 'SERVER_NOT_FOUND'));
    }
    next(err);
  }
});

virtualServerRoutes.post('/:sid/snapshot', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const sid = parseInt(String(req.params.sid));
    const result = await getClient(req).execute(sid, 'serversnapshotcreate');
    res.json(result);
  } catch (err) { next(err); }
});

// The snapshot file as the Miscellaneous page / a backup saves it ({version, data[, salt]}), plus
// `keepFiles`. Sent as a JSON body: a snapshot is far too large for a query string. The deploy
// recreates every channel with a new id; without -keepfiles their files are gone (measured on TS6).
virtualServerRoutes.post('/:sid/snapshot/deploy', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const sid = parseInt(String(req.params.sid));
    const { version, data, keepFiles } = req.body ?? {};
    if (typeof data !== 'string' || data === '' || (typeof version !== 'string' && typeof version !== 'number')) {
      throw new AppError(400, 'Not a server snapshot (version and data are missing)');
    }
    const params: Record<string, string> = { version: String(version), data };
    if (keepFiles === true) params['-keepfiles'] = '';
    const result = await getClient(req).executePost(sid, 'serversnapshotdeploy', params, true);
    res.json(result);
  } catch (err) { next(err); }
});

// The backups that hold a snapshot of this virtual server: what the compare page offers next to a file.
virtualServerRoutes.get('/:sid/snapshot/compare-sources', requireRole('admin'), (req: Request, res: Response) => {
  const sources: SnapshotBackupSource[] = backupsWithSnapshot(parseInt(String(req.params.configId)), parseInt(String(req.params.sid)));
  res.json(sources);
});

// Two snapshots of this virtual server, each a file, one in a backup, or the live server (`against`
// defaults to live). The live side is a fresh snapshot read in memory and never stored (it holds the
// server's keys and client identities). Read-only: marked as dryRun so the change log leaves it out.
virtualServerRoutes.post('/:sid/snapshot/compare', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const configId = parseInt(String(req.params.configId));
    const sid = parseInt(String(req.params.sid));
    const read = async (source: SnapshotCompareSource | undefined, side: string) => {
      if (source?.type === 'file') return readSnapshot(source.snapshot ?? {});
      if (source?.type === 'backup' && typeof source.kind === 'string' && typeof source.name === 'string') return readSnapshot(readBackupSnapshot(source.kind, source.name, configId, sid));
      if (source?.type === 'live') {
        const result = await getClient(req).execute(sid, 'serversnapshotcreate');
        return readSnapshot((Array.isArray(result) ? result[0] : result) ?? {});
      }
      throw new AppError(400, `Name a snapshot file, a backup or the live server for the ${side} side`);
    };
    const body = (req.body ?? {}) as Partial<SnapshotCompareRequest>;
    const before = await read(body.source, 'before');
    const after = await read(body.against ?? { type: 'live' }, 'after');
    res.locals.dryRun = true;
    res.json(compareSnapshots(before, after));
  } catch (err) { next(err); }
});

virtualServerRoutes.get('/:sid/connection-info', requirePermission('vserver.edit'), async (req: Request, res: Response, next) => {
  try {
    const sid = parseInt(String(req.params.sid));
    const result = await getClient(req).execute(sid, 'serverrequestconnectioninfo');
    res.json(result);
  } catch (err) { next(err); }
});

// Sends a text message to every client on this ONE virtual server, under the
// connection's own current query nickname - unlike `gm` (instance-wide,
// always shown anonymously as "server"), this is not anonymous.
virtualServerRoutes.post('/:sid/message', requirePermission('vserver.edit'), async (req: Request, res: Response, next) => {
  try {
    const sid = parseInt(String(req.params.sid));
    const { msg } = req.body;
    if (!msg) throw new AppError(400, 'A message is required');
    const result = await getClient(req).execute(sid, 'sendtextmessage', { targetmode: 3, msg });
    res.json(result);
  } catch (err) { next(err); }
});

// Wipes every group/client/channel permission on this server and recreates
// the default template groups - genuinely destructive, matches this app's
// existing Danger Zone confirmation pattern on the frontend.
virtualServerRoutes.post('/:sid/permission-reset', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const sid = parseInt(String(req.params.sid));
    const result = await getClient(req).execute(sid, 'permreset');
    res.json(result);
  } catch (err) { next(err); }
});
