import { Router, type Request, type Response } from 'express';
import type { CreateTsBanRequest, CreateWebBanRequest } from '@ts6/common';
import { AppError } from '../middleware/error-handler.js';
import type { ConnectionPool } from '../ts-client/connection-pool.js';
import { clientIpOf } from '../utils/connection-journal.js';
import { type IpBanService } from '../utils/ip-bans.js';
import { banOnTeamSpeak, type TsBanLookup } from '../utils/ts-ip-ban.js';

/**
 * Bans from the connection journal: addresses the web interface turns away, and a ban on a
 * TeamSpeak server for an address. Mounted at /api/connection-journal/bans behind the admin check.
 */
export const ipBanRoutes: Router = Router();

const bansOf = (req: Request): IpBanService => {
  const bans = req.app.locals.ipBans as IpBanService | undefined;
  if (!bans) throw new AppError(503, 'IP bans are not running');
  return bans;
};

function addressOf(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim() === '' || raw.length > 64) throw new AppError(400, 'ip must be an IP address');
  return raw.trim();
}

// GET /api/connection-journal/bans - the bans in force, with what each has turned away
ipBanRoutes.get('/', async (req: Request, res: Response, next) => {
  try { res.json(await bansOf(req).list()); } catch (err) { next(err); }
});

// GET /api/connection-journal/bans/check?ip= - what the ban dialog needs to know before it offers a ban
ipBanRoutes.get('/check', async (req: Request, res: Response, next) => {
  try { res.json(await bansOf(req).check(addressOf(req.query.ip), clientIpOf(req))); } catch (err) { next(err); }
});

// POST /api/connection-journal/bans - turn an address away from the web interface
ipBanRoutes.post('/', async (req: Request, res: Response, next) => {
  try {
    const body = (req.body ?? {}) as Partial<CreateWebBanRequest>;
    const created = await bansOf(req).create(
      { ip: addressOf(body.ip), duration: body.duration as number, reason: body.reason, confirmAdmin: body.confirmAdmin === true },
      req.user?.username ?? 'unknown',
      clientIpOf(req),
    );
    res.status(201).json(created);
  } catch (err) { next(err); }
});

// DELETE /api/connection-journal/bans/:id - lift a ban
ipBanRoutes.delete('/:id', async (req: Request, res: Response, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw new AppError(400, 'id must be a positive whole number');
    if (!(await bansOf(req).remove(id, req.user?.username ?? 'unknown'))) throw new AppError(404, 'No such ban');
    res.json({ success: true });
  } catch (err) { next(err); }
});

// POST /api/connection-journal/bans/ts - ban an address on one virtual server of a TeamSpeak
// connection, or on all of them; the ban is TeamSpeak's own (Bans page)
ipBanRoutes.post('/ts', async (req: Request, res: Response, next) => {
  try {
    const body = (req.body ?? {}) as Partial<CreateTsBanRequest>;
    const configId = Number(body.configId);
    if (!Number.isInteger(configId) || configId < 1) throw new AppError(400, 'configId must be a positive whole number');
    const sid = body.virtualServerId === 'all' ? 'all' : Number(body.virtualServerId);
    if (sid !== 'all' && (!Number.isInteger(sid) || sid < 1)) throw new AppError(400, 'virtualServerId must be a virtual server id or "all"');

    // The same guards as for the web: the address this request comes from, this machine and private
    // networks are refused (a TeamSpeak server in a container sees the Docker gateway as every client's address).
    const check = await bansOf(req).assertBannable(addressOf(body.ip), clientIpOf(req), body.confirmAdmin === true);
    const pool: ConnectionPool = req.app.locals.connectionPool;
    const result = await banOnTeamSpeak(
      pool,
      { ip: check.ip, configId, virtualServerId: sid, duration: body.duration as number, reason: body.reason, nickname: body.nickname },
      addressOf(body.ip),
    );
    (req.app.locals.tsBanLookup as TsBanLookup | undefined)?.invalidate(configId);
    const created = result.outcomes.filter((o) => o.status === 'created').length;
    console.log(`[IpBans] ${req.user?.username} banned ${check.ip} on TeamSpeak connection ${configId} (${created} of ${result.outcomes.length} virtual server(s))`);
    res.status(created > 0 ? 201 : 200).json(result);
  } catch (err) { next(err); }
});
