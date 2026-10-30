import { Router, Request, Response } from 'express';
import { requireRole, requirePermission } from '../middleware/rbac.js';
import { AppError } from '../middleware/error-handler.js';
import type { ConnectionPool } from '../ts-client/connection-pool.js';

export const virtualServerRoutes: Router = Router({ mergeParams: true });

const getClient = (req: Request) => {
  const pool: ConnectionPool = req.app.locals.connectionPool;
  return pool.getClient(parseInt(String(req.params.configId)));
};

virtualServerRoutes.get('/', async (req: Request, res: Response, next) => {
  try {
    const result = await getClient(req).execute(0, 'serverlist');
    res.json(result);
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

virtualServerRoutes.delete('/:sid', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const sid = parseInt(String(req.params.sid));
    const result = await getClient(req).execute(0, 'serverdelete', { sid });
    res.json(result);
  } catch (err) { next(err); }
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
