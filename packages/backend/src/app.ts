import express, { type Express, type Router } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { errorHandler } from './middleware/error-handler.js';
import { authMiddleware } from './middleware/auth.js';
import { requestTimeout } from './middleware/request-timeout.js';
import { ipBanMiddleware } from './middleware/ip-ban.js';
import { authRoutes } from './routes/auth.routes.js';
import { oidcAuthRoutes } from './routes/oidc-auth.routes.js';
import { serverRoutes } from './routes/servers.routes.js';
import { virtualServerRoutes } from './routes/virtual-servers.routes.js';
import { channelRoutes } from './routes/channels.routes.js';
import { clientRoutes } from './routes/clients.routes.js';
import { serverGroupRoutes } from './routes/server-groups.routes.js';
import { channelGroupRoutes } from './routes/channel-groups.routes.js';
import { permissionRoutes } from './routes/permissions.routes.js';
import { banRoutes } from './routes/bans.routes.js';
import { tokenRoutes } from './routes/tokens.routes.js';
import { fileRoutes } from './routes/files.routes.js';
import { fileDownloadRoutes } from './routes/file-downloads.routes.js';
import { iconRoutes } from './routes/icons.routes.js';
import { complaintRoutes } from './routes/complaints.routes.js';
import { messageRoutes } from './routes/messages.routes.js';
import { logRoutes } from './routes/logs.routes.js';
import { consoleRoutes } from './routes/console.routes.js';
import { instanceRoutes } from './routes/instance.routes.js';
import { dashboardRoutes } from './routes/dashboard.routes.js';
import { statisticsRoutes } from './routes/statistics.routes.js';
import { botRoutes } from './routes/bots.routes.js';
import { userRoutes } from './routes/users.routes.js';
import { userSettingsRoutes } from './routes/user-settings.routes.js';
import { musicBotRoutes } from './routes/music-bots.routes.js';
import { musicLibraryRoutes } from './routes/music-library.routes.js';
import { playlistRoutes } from './routes/playlists.routes.js';
import { radioStationRoutes } from './routes/radio-stations.routes.js';
import { musicRequestRoutes } from './routes/music-requests.routes.js';
import { commandPermissionRoutes } from './routes/command-permissions.routes.js';
import { widgetPublicRoutes } from './routes/widget-public.routes.js';
import { widgetRoutes } from './routes/widget.routes.js';
import { setupRoutes } from './routes/setup.routes.js';
import { publicConfigRoutes } from './routes/public-config.routes.js';
import { settingsRoutes } from './routes/settings.routes.js';
import { updateCheckRoutes } from './routes/update-check.routes.js';
import { ytCookieCheckRoutes } from './routes/yt-cookie-check.routes.js';
import { requireServerAccess } from './middleware/server-access.js';
import { requireRole } from './middleware/rbac.js';
import { adminExcept, SIGNED_IN, type OpenRoute } from './middleware/access-policy.js';
import { connectionJournalRoutes } from './routes/connection-journal.routes.js';
import { changeLogRoutes } from './routes/change-log.routes.js';
import { backupRoutes, backupDownloadRoutes } from './routes/backups.routes.js';
import { changeLogMiddleware } from './middleware/change-log.js';
import { recordRateLimitHit } from './utils/connection-journal.js';

export function createApp(): Express {
  const app = express();

  // How many proxies (nginx, Coolify's Traefik, a CDN, ...) stand between the
  // visitor and this process decides which X-Forwarded-For entry is believed -
  // one hop unless TRUST_PROXY says otherwise. It sets req.ip, which the login
  // rate limit below keys on.
  app.set('trust proxy', config.trustProxy.value);

  app.use(requestTimeout);
  app.use(helmet());
  app.use(cors({ origin: config.frontendUrl, credentials: true }));
  // A banned address is turned away before anything else is read or parsed - after CORS, so
  // the browser of a banned visitor can still read the answer.
  app.use(ipBanMiddleware);
  app.use(express.json({ limit: '10mb' }));

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // H1: Rate limiting on auth endpoints
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts, please try again later' },
    // The default answer, plus a row in the connection journal (one per address
    // and minute, however many requests the limit keeps turning away).
    handler: (req, res, _next, options) => {
      recordRateLimitHit(req, req.originalUrl.startsWith('/api/auth/refresh') ? 'refresh-limit' : 'login-limit');
      res.status(options.statusCode).send(options.message);
    },
  });
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/refresh', authLimiter);

  // Public routes
  app.use('/api/setup', setupRoutes);
  app.use('/api/public-config', publicConfigRoutes);
  // The account routes in here (password, 2FA, language) sign the caller in themselves, so the
  // change log is mounted in front of them as well; it reads the user once the response is out.
  app.use('/api/auth', changeLogMiddleware);
  app.use('/api/auth', authRoutes);
  app.use('/api/auth/oidc', oidcAuthRoutes);

  // Bot webhook route (unauthenticated — called by external systems)
  app.all('/api/bots/webhook/*path', (req, res) => {
    const engine = req.app.locals.botEngine;
    if (!engine) return res.status(503).json({ error: 'Bot engine not running' });
    engine.handleWebhookRequest(req, res);
  });

  // Public widget routes (unauthenticated — embeddable on external sites)
  app.use('/api/widget', widgetPublicRoutes);

  // One-time file download links (unauthenticated — the link itself is the
  // credential, see file-downloads.routes.ts)
  app.use('/api/file-downloads', fileDownloadRoutes);
  // Same for backup downloads (see backups.routes.ts)
  app.use('/api/backup-downloads', backupDownloadRoutes);  // Protected routes
  app.use('/api', authMiddleware);
  // Records every writing request a web user makes (R6). This mount covers all
  // of them behind the login check, before the route handlers, so no handler has
  // to be touched (the /api/auth one above covers the account routes); see
  // middleware/change-log.ts for the fail-closed vs. after-the-fact split and
  // middleware/change-log-policy.ts for what counts.
  app.use('/api', changeLogMiddleware);
  app.use('/api/servers', serverRoutes);

  // H9: Server access control on all :configId routes, then the permission gate: every mount below
  // is admin-only except for the requests listed with it, each for the roles holding the permission
  // it names (ROLE_PERMISSIONS in @ts6/common). That list is all a non-admin can reach on that
  // mount - a route added to a router later stays admin-only until it is opened here (see
  // middleware/access-policy.ts; access-matrix.test.ts pins the result for every route and role).
  // A trailing '/*' is used only where a whole router belongs to one permission.
  const serverAccess = requireServerAccess();
  const serverScoped = (path: string, router: Router, open: readonly OpenRoute[] = []) =>
    app.use(`/api/servers/:configId/${path}`, serverAccess, adminExcept(open), router);

  // Creating, starting, stopping, deleting, snapshots and the permission reset stay admin-only.
  serverScoped('virtual-servers', virtualServerRoutes, [
    { method: 'GET', path: '/', permission: 'server.view' },
    { method: 'GET', path: '/:sid/info', permission: 'vserver.edit' },
    { method: 'PUT', path: '/:sid', permission: 'vserver.edit' },
    { method: 'GET', path: '/:sid/connection-info', permission: 'vserver.edit' },
    { method: 'POST', path: '/:sid/message', permission: 'vserver.edit' },
  ]);
  serverScoped('vs/:sid/channels', channelRoutes, [
    { method: 'GET', path: '/', permission: 'server.view' },
    { method: 'GET', path: '/:cid', permission: 'channels.edit' },
    { method: 'POST', path: '/', permission: 'channels.edit' },
    { method: 'PUT', path: '/:cid', permission: 'channels.edit' },
    { method: 'POST', path: '/:cid/move', permission: 'channels.edit' },
    { method: 'DELETE', path: '/:cid', permission: 'channels.delete' },
    { method: '*', path: '/:cid/permissions', permission: 'permissions.edit' },
    { method: '*', path: '/:cid/clients/:cldbid/permissions', permission: 'permissions.edit' },
  ]);
  serverScoped('vs/:sid/clients', clientRoutes, [
    { method: 'GET', path: '/', permission: 'server.view' },
    { method: 'POST', path: '/:clid/poke', permission: 'clients.message' },
    { method: 'POST', path: '/:clid/message', permission: 'clients.message' },
    { method: 'POST', path: '/:clid/move', permission: 'clients.move' },
    { method: 'POST', path: '/bulk/move', permission: 'clients.move' },
    { method: 'POST', path: '/:clid/kick', permission: 'clients.kick' },
    { method: 'POST', path: '/bulk/kick', permission: 'clients.kick' },
    { method: 'POST', path: '/:clid/ban', permission: 'clients.ban' },
    { method: 'POST', path: '/bulk/ban', permission: 'clients.ban' },
    { method: 'GET', path: '/:clid', permission: 'clients.manage' },
    { method: 'GET', path: '/:clid/groups', permission: 'clients.manage' },
    { method: 'POST', path: '/bulk/describe', permission: 'clients.manage' },
    { method: '*', path: '/:cldbid/permissions', permission: 'permissions.edit' },
    { method: '*', path: '/database/*', permission: 'clients.database' },
  ]);
  serverScoped('vs/:sid/server-groups', serverGroupRoutes, [
    { method: 'GET', path: '/', permission: 'groups.view' },
    { method: 'POST', path: '/', permission: 'groups.edit' },
    { method: 'PUT', path: '/:sgid', permission: 'groups.edit' },
    { method: 'DELETE', path: '/:sgid', permission: 'groups.edit' },
    { method: 'POST', path: '/:sgid/copy', permission: 'groups.edit' },
    { method: 'GET', path: '/:sgid/members', permission: 'groups.members' },
    { method: 'POST', path: '/:sgid/members', permission: 'groups.members' },
    { method: 'DELETE', path: '/:sgid/members/:cldbid', permission: 'groups.members' },
    { method: '*', path: '/:sgid/permissions', permission: 'permissions.edit' },
  ]);
  serverScoped('vs/:sid/channel-groups', channelGroupRoutes, [
    { method: 'GET', path: '/', permission: 'groups.members' },
    { method: 'GET', path: '/:cgid/clients', permission: 'groups.members' },
    { method: 'GET', path: '/by-client/:cldbid', permission: 'groups.members' },
    { method: 'POST', path: '/:cgid/assign', permission: 'groups.members' },
    { method: 'POST', path: '/', permission: 'groups.edit' },
    { method: 'PUT', path: '/:cgid', permission: 'groups.edit' },
    { method: 'DELETE', path: '/:cgid', permission: 'groups.edit' },
    { method: '*', path: '/:cgid/permissions', permission: 'permissions.edit' },
  ]);
  // The automatic groups (servergroupautoaddperm) act on every virtual server of the instance: admin-only.
  serverScoped('vs/:sid/permissions', permissionRoutes, [
    { method: 'GET', path: '/', permission: 'permissions.edit' },
    { method: 'GET', path: '/find', permission: 'permissions.edit' },
    { method: 'GET', path: '/overview/:cldbid', permission: 'permissions.edit' },
  ]);
  serverScoped('vs/:sid/bans', banRoutes, [
    { method: 'GET', path: '/', permission: 'bans.view' },
    { method: 'POST', path: '/', permission: 'bans.manage' },
    { method: 'DELETE', path: '/', permission: 'bans.manage' },
    { method: 'DELETE', path: '/:banid', permission: 'bans.manage' },
  ]);
  serverScoped('vs/:sid/tokens', tokenRoutes, [{ method: '*', path: '/*', permission: 'tokens.manage' }]);
  serverScoped('vs/:sid/files', fileRoutes, [{ method: '*', path: '/*', permission: 'files.manage' }]);
  serverScoped('vs/:sid/icons', iconRoutes, [
    { method: 'GET', path: '/', permission: 'server.view' },
    { method: 'GET', path: '/usage', permission: 'server.view' },
    { method: 'GET', path: '/:iconId/image', permission: 'server.view' },
    { method: 'POST', path: '/', permission: 'icons.manage' },
    { method: 'POST', path: '/bulk/delete', permission: 'icons.manage' },
    { method: 'DELETE', path: '/:iconId', permission: 'icons.manage' },
  ]);
  serverScoped('vs/:sid/complaints', complaintRoutes, [{ method: '*', path: '/*', permission: 'complaints.manage' }]);
  serverScoped('vs/:sid/messages', messageRoutes, [{ method: '*', path: '/*', permission: 'messages.manage' }]);
  // The server log carries client IP addresses and every admin's actions: admin-only.
  serverScoped('vs/:sid/logs', logRoutes);
  serverScoped('console', consoleRoutes);
  serverScoped('instance', instanceRoutes);
  serverScoped('command-permissions', commandPermissionRoutes, [{ method: 'GET', path: '/', permission: 'music.manage' }]);
  serverScoped('vs/:sid/dashboard', dashboardRoutes, [
    { method: 'GET', path: '/', permission: 'server.view' },
    { method: 'GET', path: '/bandwidth-history', permission: 'server.view' },
    { method: 'GET', path: '/user-history', permission: 'server.view' },
    { method: '*', path: '/online-filter', permission: 'vserver.edit' },
  ]);
  // The statistics page also reads the instance's host information, so it stays admin-only as a whole.
  serverScoped('vs/:sid/statistics', statisticsRoutes);
  // The Music Bots page's own routers: all of it is music.manage (each router checks that as well).
  serverScoped('music-library', musicLibraryRoutes, [{ method: '*', path: '/*', permission: 'music.manage' }]);
  serverScoped('radio-stations', radioStationRoutes, [{ method: '*', path: '/*', permission: 'music.manage' }]);
  serverScoped('music-requests', musicRequestRoutes, [{ method: 'GET', path: '/', permission: 'music.manage' }]);

  // Not under :configId, same rule: admin-only except what is listed.
  app.use('/api/bots', adminExcept([
    { method: 'GET', path: '/', permission: 'server.view' }, // the flow list on the Dashboard
    { method: 'POST', path: '/', permission: 'bots.manage' },
    { method: 'GET', path: '/:botId', permission: 'bots.manage' },
    { method: 'PUT', path: '/:botId', permission: 'bots.manage' },
    { method: 'DELETE', path: '/:botId', permission: 'bots.manage' },
    { method: 'POST', path: '/:botId/enable', permission: 'bots.manage' },
    { method: 'POST', path: '/:botId/disable', permission: 'bots.manage' },
    { method: 'GET', path: '/:botId/executions', permission: 'bots.manage' },
    { method: 'GET', path: '/:botId/executions/:execId/logs', permission: 'bots.manage' },
  ]), botRoutes);
  app.use('/api/users', userRoutes);
  // A user's own settings (dashboard layout, ...): every role, but only ever the caller's rows.
  app.use('/api/user-settings', adminExcept([
    { method: 'GET', path: '/', permission: SIGNED_IN },
    { method: 'PUT', path: '/:key', permission: SIGNED_IN },
    { method: 'DELETE', path: '/:key', permission: SIGNED_IN },
  ]), userSettingsRoutes);
  app.use('/api/music-bots', musicBotRoutes);
  app.use('/api/playlists', playlistRoutes);
  app.use('/api/widgets', requireRole('admin'), widgetRoutes);
  app.use('/api/settings', adminExcept([
    { method: 'GET', path: '/webgui-theme', permission: SIGNED_IN },
    { method: 'GET', path: '/webgui-base-theme', permission: SIGNED_IN },
    { method: 'GET', path: '/webgui-design', permission: SIGNED_IN },
  ]), settingsRoutes);
  app.use('/api/connection-journal', requireRole('admin'), connectionJournalRoutes);
  app.use('/api/backups', requireRole('admin'), backupRoutes);
  app.use('/api/change-log', requireRole('admin'), changeLogRoutes);  // The banners in the layout read the cached results for every role; forcing a fresh check is an admin's.
  app.use('/api/update-check', adminExcept([{ method: 'GET', path: '/', permission: SIGNED_IN }]), updateCheckRoutes);
  app.use('/api/yt-cookie-check', adminExcept([{ method: 'GET', path: '/', permission: SIGNED_IN }]), ytCookieCheckRoutes);

  // 404 for unmatched routes. Without this, Express's own default 404
  // page (finalhandler) overwrites helmet's Content-Security-Policy
  // header with a bare "default-src 'none'" that omits frame-ancestors
  // and form-action, which ZAP flags (CSP: Failure to Define Directive
  // with No Fallback) - answering here ourselves keeps helmet's headers
  // intact.
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}
