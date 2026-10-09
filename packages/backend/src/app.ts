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
import { adminExcept, BOT_FLOW_ROLES, EVERY_ROLE, MUSIC_ROLES, type OpenRoute } from './middleware/access-policy.js';
import { connectionJournalRoutes } from './routes/connection-journal.routes.js';
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

  // Protected routes
  app.use('/api', authMiddleware);
  app.use('/api/servers', serverRoutes);

  // H9: Server access control on all :configId routes, then the role gate: every mount below is
  // admin-only except for the requests listed with it. That list is all a viewer, bot operator or
  // music operator can reach on that mount - a route added to a router later stays admin-only
  // until it is opened here (see middleware/access-policy.ts).
  const serverAccess = requireServerAccess();
  const serverScoped = (path: string, router: Router, open: readonly OpenRoute[] = []) =>
    app.use(`/api/servers/:configId/${path}`, serverAccess, adminExcept(open), router);

  serverScoped('virtual-servers', virtualServerRoutes, [{ method: 'GET', path: '/', roles: EVERY_ROLE }]);
  serverScoped('vs/:sid/channels', channelRoutes, [{ method: 'GET', path: '/', roles: EVERY_ROLE }]);
  serverScoped('vs/:sid/clients', clientRoutes, [{ method: 'GET', path: '/', roles: EVERY_ROLE }]);
  serverScoped('vs/:sid/server-groups', serverGroupRoutes, [{ method: 'GET', path: '/', roles: MUSIC_ROLES }]);
  serverScoped('vs/:sid/channel-groups', channelGroupRoutes);
  serverScoped('vs/:sid/permissions', permissionRoutes);
  serverScoped('vs/:sid/bans', banRoutes);
  serverScoped('vs/:sid/tokens', tokenRoutes);
  serverScoped('vs/:sid/files', fileRoutes);
  serverScoped('vs/:sid/icons', iconRoutes, [
    { method: 'GET', path: '/', roles: EVERY_ROLE },
    { method: 'GET', path: '/usage', roles: EVERY_ROLE },
    { method: 'GET', path: '/:iconId/image', roles: EVERY_ROLE },
  ]);
  serverScoped('vs/:sid/complaints', complaintRoutes);
  serverScoped('vs/:sid/messages', messageRoutes);
  serverScoped('vs/:sid/logs', logRoutes);
  serverScoped('console', consoleRoutes);
  serverScoped('instance', instanceRoutes);
  serverScoped('command-permissions', commandPermissionRoutes, [{ method: 'GET', path: '/', roles: MUSIC_ROLES }]);
  serverScoped('vs/:sid/dashboard', dashboardRoutes, [
    { method: 'GET', path: '/', roles: EVERY_ROLE },
    { method: 'GET', path: '/bandwidth-history', roles: EVERY_ROLE },
    { method: 'GET', path: '/user-history', roles: EVERY_ROLE },
  ]);
  serverScoped('vs/:sid/statistics', statisticsRoutes);
  // The Music Bots page's own routers: all of it is for the music roles (each router checks that as well).
  serverScoped('music-library', musicLibraryRoutes, [{ method: '*', path: '/*', roles: MUSIC_ROLES }]);
  serverScoped('radio-stations', radioStationRoutes, [{ method: '*', path: '/*', roles: MUSIC_ROLES }]);
  serverScoped('music-requests', musicRequestRoutes, [{ method: 'GET', path: '/', roles: MUSIC_ROLES }]);

  // Not under :configId, same rule: admin-only except what is listed.
  app.use('/api/bots', adminExcept([
    { method: 'GET', path: '/', roles: EVERY_ROLE }, // the flow list on the Dashboard
    { method: 'POST', path: '/', roles: BOT_FLOW_ROLES },
    { method: 'GET', path: '/:botId', roles: BOT_FLOW_ROLES },
    { method: 'PUT', path: '/:botId', roles: BOT_FLOW_ROLES },
    { method: 'DELETE', path: '/:botId', roles: BOT_FLOW_ROLES },
    { method: 'POST', path: '/:botId/enable', roles: BOT_FLOW_ROLES },
    { method: 'POST', path: '/:botId/disable', roles: BOT_FLOW_ROLES },
    { method: 'GET', path: '/:botId/executions', roles: BOT_FLOW_ROLES },
    { method: 'GET', path: '/:botId/executions/:execId/logs', roles: BOT_FLOW_ROLES },
  ]), botRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/music-bots', musicBotRoutes);
  app.use('/api/playlists', playlistRoutes);
  app.use('/api/widgets', requireRole('admin'), widgetRoutes);
  app.use('/api/settings', adminExcept([
    { method: 'GET', path: '/webgui-theme', roles: EVERY_ROLE },
    { method: 'GET', path: '/webgui-base-theme', roles: EVERY_ROLE },
  ]), settingsRoutes);
  app.use('/api/connection-journal', requireRole('admin'), connectionJournalRoutes);
  // The banners in the layout read the cached results for every role; forcing a fresh check is an admin's.
  app.use('/api/update-check', adminExcept([{ method: 'GET', path: '/', roles: EVERY_ROLE }]), updateCheckRoutes);
  app.use('/api/yt-cookie-check', adminExcept([{ method: 'GET', path: '/', roles: EVERY_ROLE }]), ytCookieCheckRoutes);

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
