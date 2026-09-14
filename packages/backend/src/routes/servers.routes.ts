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
        createdAt: true, sshUsername: true,
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
    });
  } catch (err) { next(err); }
});

// Update server connection
serverRoutes.put('/:configId', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const id = parseInt(String(req.params.configId));
    const data: any = {};

    const fields = ['name', 'host', 'webqueryPort', 'apiKey', 'useHttps', 'sshPort', 'sshUsername', 'sshPassword', 'enabled', 'botQueryName'];
    for (const field of fields) {
      if (req.body[field] !== undefined) {
        // Don't overwrite API key or SSH password with empty strings
        if ((field === 'apiKey' || field === 'sshPassword') && req.body[field] === '') continue;
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

    // A fresh query login starts in whatever default group new ServerQuery
    // clients get (usually little to no permissions) - without this, every
    // bot-flow action would fail with "insufficient client permissions".
    // Mirror whatever server group(s) the admin identity itself is in, so the
    // new identity can do everything a bot flow could already do before.
    const whoami = await adminClient.execute(1, 'whoami');
    const adminCldbid = whoami?.[0]?.client_database_id;
    const adminGroups = adminCldbid ? await adminClient.execute(1, 'servergroupsbyclientid', { cldbid: adminCldbid }) : [];

    const loginResult = await adminClient.executePost(0, 'queryloginadd', { client_login_name: name });
    const cldbid = loginResult?.[0]?.cldbid;
    if (!cldbid) throw new AppError(502, 'TeamSpeak did not return a client database ID for the new query login');

    for (const group of adminGroups ?? []) {
      if (!group.sgid) continue;
      try {
        await adminClient.executePost(1, 'servergroupaddclient', { sgid: group.sgid, cldbid });
      } catch (err: any) {
        console.warn(`[servers.routes] Failed to add new bot identity (cldbid=${cldbid}) to server group ${group.sgid}: ${err.message}`);
      }
    }

    const keyResult = await adminClient.executePost(0, 'apikeyadd', { scope: 'write', lifetime: 0, cldbid });
    const apikey = keyResult?.[0]?.apikey;
    if (!apikey) throw new AppError(502, 'TeamSpeak did not return an API key for the new query login');

    await prisma.tsServerConfig.update({
      where: { id },
      data: { botQueryName: name, botApiKey: encrypt(apikey) },
    });

    await pool.refreshBotClient(id);

    res.status(201).json({ name });
  } catch (err) { next(err); }
});
