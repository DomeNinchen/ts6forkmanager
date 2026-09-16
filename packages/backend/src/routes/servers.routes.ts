import { Router, Request, Response } from 'express';
import { requireRole } from '../middleware/rbac.js';
import { AppError } from '../middleware/error-handler.js';
import { WebQueryClient } from '../ts-client/webquery-client.js';
import type { ConnectionPool } from '../ts-client/connection-pool.js';
import { encrypt, decrypt } from '../utils/crypto.js';

export const serverRoutes: Router = Router();

// List all configured TS server connections. Admins see everything; every
// other role only sees servers they've actually been granted access to
// (see UserServerAccess) - previously this returned every server to every
// authenticated user regardless of role, which is what let a fresh viewer
// with zero grants still see (and pick) a server in the header dropdown,
// only to hit "no access" once they tried to use it.
serverRoutes.get('/', async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const servers = await prisma.tsServerConfig.findMany({
      where: req.user!.role === 'admin' ? undefined : {
        userAccess: { some: { userId: req.user!.id } },
      },
      select: {
        id: true, name: true, host: true, webqueryPort: true,
        useHttps: true, sshPort: true, enabled: true,
        createdAt: true, sshUsername: true, pingHost: true,
        botQueryName: true, botApiKey: true,
      },
      orderBy: { id: 'asc' },
    });

    res.json(servers.map((s: any) => ({
      ...s,
      hasSshCredentials: !!s.sshUsername,
      sshUsername: undefined,
      hasBotIdentity: !!s.botApiKey,
      botApiKey: undefined,
    })));
  } catch (err) { next(err); }
});

// Add new TS server connection
serverRoutes.post('/', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const { name, host, webqueryPort, apiKey, useHttps, sshPort, sshUsername, sshPassword } = req.body;
    if (!name || !host || !apiKey) throw new AppError(400, 'Name, host, and API key are required');

    const prisma = req.app.locals.prisma;
    // H8: Encrypt sensitive fields at rest
    const server = await prisma.tsServerConfig.create({
      data: {
        name,
        host,
        webqueryPort: webqueryPort || 10080,
        apiKey: encrypt(apiKey),
        useHttps: useHttps || false,
        sshPort: sshPort || 10022,
        sshUsername: sshUsername || null,
        sshPassword: sshPassword ? encrypt(sshPassword) : null,
      },
    });

    // Add to connection pool (use plaintext key for connection)
    const pool: ConnectionPool = req.app.locals.connectionPool;
    pool.addClient(server.id, server.host, server.webqueryPort, apiKey, server.useHttps);

    res.status(201).json({ id: server.id, name: server.name });
  } catch (err) { next(err); }
});

// Get server connection details
serverRoutes.get('/:configId', async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const server = await prisma.tsServerConfig.findUnique({
      where: { id: parseInt(String(req.params.configId)) },
    });
    if (!server) throw new AppError(404, 'Server config not found');

    res.json({
      id: server.id, name: server.name, host: server.host,
      webqueryPort: server.webqueryPort, useHttps: server.useHttps,
      sshPort: server.sshPort, hasSshCredentials: !!server.sshUsername,
      enabled: server.enabled, createdAt: server.createdAt,
      botQueryName: server.botQueryName, hasBotIdentity: !!server.botApiKey,
      pingHost: server.pingHost,
      queryNickname: server.queryNickname,
    });
  } catch (err) { next(err); }
});

// Update server connection
serverRoutes.put('/:configId', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const id = parseInt(String(req.params.configId));
    const data: any = {};

    const fields = ['name', 'host', 'webqueryPort', 'apiKey', 'useHttps', 'sshPort', 'sshUsername', 'sshPassword', 'enabled', 'botQueryName', 'pingHost', 'queryNickname'];
    for (const field of fields) {
      if (req.body[field] !== undefined) {
        // Don't overwrite API key, SSH username, or SSH password with empty
        // strings - the frontend never receives these back after saving them
        // (GET strips them to a hasSshCredentials/hasBotIdentity-style flag,
        // never the raw value), so its edit form always starts these fields
        // blank. Without this guard, saving any other field (e.g. rotating
        // the API key) silently wiped sshUsername/sshPassword on every save.
        if ((field === 'apiKey' || field === 'sshPassword' || field === 'sshUsername') && req.body[field] === '') continue;
        // H8: Encrypt sensitive fields
        if (field === 'apiKey' || field === 'sshPassword') {
          data[field] = encrypt(req.body[field]);
        } else {
          data[field] = req.body[field];
        }
      }
    }

    const server = await prisma.tsServerConfig.update({ where: { id }, data });

    // Refresh connection pool
    const pool: ConnectionPool = req.app.locals.connectionPool;
    await pool.refreshClient(id);
    // Re-applies the nickname too if botQueryName changed - a no-op if no bot identity is provisioned yet
    await pool.refreshBotClient(id);

    // If any SSH-relevant field changed, existing EventBridge connections
    // (event registration, command listeners) are still running on the old
    // credentials — they don't pick up new ones on their own since connecting
    // no-ops while already connected. Force a reconnect.
    const sshFieldsChanged = ['host', 'sshPort', 'sshUsername', 'sshPassword'].some(f => data[f] !== undefined);
    if (sshFieldsChanged) {
      await req.app.locals.botEngine?.refreshServerConnections(id);
    }

    res.json({ id: server.id, name: server.name });
  } catch (err) { next(err); }
});

// Delete server connection
serverRoutes.delete('/:configId', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const id = parseInt(String(req.params.configId));
    await prisma.tsServerConfig.delete({ where: { id } });

    const pool: ConnectionPool = req.app.locals.connectionPool;
    pool.removeClient(id);

    res.status(204).send();
  } catch (err) { next(err); }
});

// Current query identity (whoami) - lets the UI show the actual live nickname
// rather than assuming it matches whatever's stored, since a fresh connection
// could still be running under TS's own default until the next reconnect.
serverRoutes.get('/:configId/identity', async (req: Request, res: Response, next) => {
  try {
    const pool: ConnectionPool = req.app.locals.connectionPool;
    const client = pool.getClient(parseInt(String(req.params.configId)));
    // whoami at sid=0 (no virtual server context) comes back mostly blank -
    // client_nickname included - so this needs a real virtual server context
    // the same way the Bot Identity provisioning flow already does.
    const sid = req.query.sid ? parseInt(String(req.query.sid)) : 1;
    const result = await client.execute(sid, 'whoami');
    res.json(Array.isArray(result) ? result[0] : result);
  } catch (err) { next(err); }
});

// Rename this connection's own (shared/admin) query identity - distinct from
// the optional bot identity above, which only covers bot-flow actions. This
// is what a manual WebUI action (e.g. renaming a channel) shows as the actor
// in TS's own logs.
serverRoutes.put('/:configId/identity', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const { nickname, sid } = req.body;
    if (!nickname) throw new AppError(400, 'A nickname is required');

    const id = parseInt(String(req.params.configId));
    const pool: ConnectionPool = req.app.locals.connectionPool;
    // clientupdate at sid=0 (no virtual server context) fails with "invalid
    // serverID" - needs a real virtual server context, same as whoami above.
    await pool.getClient(id).execute(sid ?? 1, 'clientupdate', { client_nickname: nickname });

    const prisma = req.app.locals.prisma;
    await prisma.tsServerConfig.update({ where: { id }, data: { queryNickname: nickname } });

    res.json({ nickname });
  } catch (err) { next(err); }
});

// Sends an anonymous ("server") text message to every virtual server on this
// TeamSpeak instance at once - an instance-level broadcast, not scoped to any
// one virtual server.
serverRoutes.post('/:configId/global-message', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const { msg } = req.body;
    if (!msg) throw new AppError(400, 'A message is required');

    const pool: ConnectionPool = req.app.locals.connectionPool;
    const client = pool.getClient(parseInt(String(req.params.configId)));
    const result = await client.execute(0, 'gm', { msg });
    res.json(result);
  } catch (err) { next(err); }
});

// Test connection
serverRoutes.post('/:configId/test', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const server = await prisma.tsServerConfig.findUnique({
      where: { id: parseInt(String(req.params.configId)) },
    });
    if (!server) throw new AppError(404, 'Server config not found');

    const client = new WebQueryClient(server.host, server.webqueryPort, decrypt(server.apiKey), server.useHttps);
    const result = await client.testConnection();
    client.destroy(); // Close the temporary TCP connection immediately

    res.json(result);
  } catch (err) { next(err); }
});

// Provision a separate, dedicated ServerQuery identity used only for bot-flow
// actions, so they're attributed to their own name in TS's own logs/notifications
// instead of the same "admin" identity every manual WebUI action already uses.
// Entirely optional - bot flows work exactly as before (via the main connection)
// on any server this is never run for.
serverRoutes.post('/:configId/bot-identity', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const { name } = req.body;
    if (!name) throw new AppError(400, 'A display name is required');

    const id = parseInt(String(req.params.configId));
    const prisma = req.app.locals.prisma;
    const server = await prisma.tsServerConfig.findUnique({ where: { id } });
    if (!server) throw new AppError(404, 'Server config not found');

    const pool: ConnectionPool = req.app.locals.connectionPool;
    const adminClient = pool.getClient(id);

    // WebQuery always returns numeric fields as strings - kept as-is here
    // since it's only ever fed back into other WebQuery calls, until the
    // final Prisma write below, which needs a real Int.
    let cldbid: number | string | undefined = server.botCldbid ?? undefined;

    if (cldbid) {
      // Already provisioned (this call is a reissue, e.g. to pick up a scope
      // fix) - the underlying ServerQuery login already exists and is
      // already in the right server groups, so skip straight to minting a
      // fresh key for it.
    } else if (server.botApiKey && server.botQueryName) {
      // Provisioned before botCldbid existed - look up the same login by the
      // name it was actually created with rather than creating a duplicate.
      const existing = await adminClient.executePost(0, 'queryloginlist', { pattern: server.botQueryName });
      cldbid = existing?.[0]?.cldbid;
      if (!cldbid) throw new AppError(502, 'Could not find the existing bot identity to reissue its key');
    } else {
      // First-time provisioning. A fresh query login starts in whatever
      // default group new ServerQuery clients get (usually little to no
      // permissions) - without this, every bot-flow action would fail with
      // "insufficient client permissions". Mirror whatever server group(s)
      // the admin identity itself is in, so the new identity can do
      // everything a bot flow could already do before.
      const whoami = await adminClient.execute(1, 'whoami');
      const adminCldbid = whoami?.[0]?.client_database_id;
      const adminGroups = adminCldbid ? await adminClient.execute(1, 'servergroupsbyclientid', { cldbid: adminCldbid }) : [];

      const loginResult = await adminClient.executePost(0, 'queryloginadd', { client_login_name: name });
      cldbid = loginResult?.[0]?.cldbid;
      if (!cldbid) throw new AppError(502, 'TeamSpeak did not return a client database ID for the new query login');

      for (const group of adminGroups ?? []) {
        if (!group.sgid) continue;
        try {
          await adminClient.executePost(1, 'servergroupaddclient', { sgid: group.sgid, cldbid });
        } catch (err: any) {
          console.warn(`[servers.routes] Failed to add new bot identity (cldbid=${cldbid}) to server group ${group.sgid}: ${err.message}`);
        }
      }
    }

    // scope=manage, not just write - write turned out to be too narrow for
    // plenty of ordinary bot-flow actions (e.g. plain info reads like
    // `serverinfo` failed with "out of scope"), so it didn't actually have
    // "the same permissions as the main connection" as intended. The
    // official TeamSpeak quickstart's own example API key uses scope=manage
    // for exactly this kind of general-purpose use.
    const keyResult = await adminClient.executePost(0, 'apikeyadd', { scope: 'manage', lifetime: 0, cldbid });
    const apikey = keyResult?.[0]?.apikey;
    if (!apikey) throw new AppError(502, 'TeamSpeak did not return an API key for the new query login');

    await prisma.tsServerConfig.update({
      where: { id },
      data: { botQueryName: name, botApiKey: encrypt(apikey), botCldbid: Number(cldbid) },
    });

    await pool.refreshBotClient(id);

    res.status(201).json({ name });
  } catch (err) { next(err); }
});
