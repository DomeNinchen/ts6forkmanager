import { Router, Request, Response } from 'express';
import { raidSettingsProblem, type RaidIncidentEntry, type RaidProtectionView, type RaidSettings } from '@ts6/common';
import { mayRole } from '../utils/role-table.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { requirePermission, requireRole } from '../middleware/rbac.js';
import { AppError } from '../middleware/error-handler.js';
import { targetIds } from '../utils/protected-groups.js';
import { toIncidentEntry, toRaidConfig, type RaidProtectionService } from '../utils/raid-protection.js';

// Raid protection (R15): seen by whoever may kick (his decision 11), set up by admins only.
export const raidProtectionRoutes: Router = Router({ mergeParams: true });

const INCIDENTS_MAX = 200;
const DAY_MS = 86_400_000;

/** Addresses (and the networks a rule fired for) only for those who may see client addresses (R8: clients.manage, the right that shows a client's IP). */
function forViewer(req: Request, entry: RaidIncidentEntry): RaidIncidentEntry {
  if (req.user?.role === 'admin' || mayRole(req.user?.role, 'clients.manage')) return entry;
  return {
    ...entry,
    clients: entry.clients.map((c) => ({ ...c, ip: null })),
    hits: entry.hits.map((h) => (h.rule === 'subnet' ? { ...h, key: null } : h)),
  };
}

function scope(req: Request) {
  return {
    prisma: req.app.locals.prisma as PrismaClient,
    raid: req.app.locals.raidProtection as RaidProtectionService,
    serverConfigId: parseInt(String(req.params.configId)),
    sid: parseInt(String(req.params.sid)),
  };
}

raidProtectionRoutes.get('/', requirePermission('clients.kick'), async (req: Request, res: Response, next) => {
  try {
    const { prisma, raid, serverConfigId, sid } = scope(req);
    const row = await prisma.raidProtection.findUnique({ where: { serverConfigId_sid: { serverConfigId, sid } } });
    const view: RaidProtectionView = { config: toRaidConfig(row), status: raid.status(serverConfigId, sid) };
    res.json(view);
  } catch (err) { next(err); }
});

// Switch on/off and the settings. The first switch-on starts the observe-only time (his decision 3).
raidProtectionRoutes.put('/', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const { prisma, raid, serverConfigId, sid } = scope(req);
    const { enabled, settings } = req.body ?? {};
    if (typeof enabled !== 'boolean') throw new AppError(400, 'enabled must be true or false');
    const problem = raidSettingsProblem(settings as RaidSettings);
    if (problem) throw new AppError(400, `Invalid raid protection settings: ${problem}`);
    const s = settings as RaidSettings;
    // Only the known fields are stored.
    const clean: RaidSettings = {
      rules: {
        total: { enabled: s.rules.total.enabled, count: s.rules.total.count, windowSec: s.rules.total.windowSec },
        subnet: { enabled: s.rules.subnet.enabled, count: s.rules.subnet.count, windowSec: s.rules.subnet.windowSec },
        country: { enabled: s.rules.country.enabled, count: s.rules.country.count, windowSec: s.rules.country.windowSec },
        name: { enabled: s.rules.name.enabled, count: s.rules.name.count, windowSec: s.rules.name.windowSec },
        new: { enabled: s.rules.new.enabled, count: s.rules.new.count, windowSec: s.rules.new.windowSec, sharePct: s.rules.new.sharePct },
      },
      exemptGroupIds: [...new Set(s.exemptGroupIds)],
      knownSessions: s.knownSessions,
      graceMin: s.graceMin,
      observeDays: s.observeDays,
      notify: s.notify,
      notifyGroupIds: [...new Set(s.notifyGroupIds)],
      notifyText: s.notifyText,
    };
    const existing = await prisma.raidProtection.findUnique({ where: { serverConfigId_sid: { serverConfigId, sid } } });
    const now = new Date();
    const firstOn = enabled && !existing?.firstEnabledAt;
    const data = {
      enabled,
      settings: JSON.stringify(clean),
      ...(firstOn ? { firstEnabledAt: now, observeUntil: new Date(now.getTime() + clean.observeDays * DAY_MS) } : {}),
    };
    const row = await prisma.raidProtection.upsert({
      where: { serverConfigId_sid: { serverConfigId, sid } },
      create: { serverConfigId, sid, ...data },
      update: data,
    });
    await raid.reload(serverConfigId, sid);
    const view: RaidProtectionView = { config: toRaidConfig(row), status: raid.status(serverConfigId, sid) };
    res.json(view);
  } catch (err) { next(err); }
});

// Incidents, newest first (?limit, at most INCIDENTS_MAX).
raidProtectionRoutes.get('/incidents', requirePermission('clients.kick'), async (req: Request, res: Response, next) => {
  try {
    const { prisma, serverConfigId, sid } = scope(req);
    const limit = Math.min(INCIDENTS_MAX, Math.max(1, parseInt(String(req.query.limit ?? '50')) || 50));
    const rows = await prisma.raidIncident.findMany({ where: { serverConfigId, sid }, orderBy: { startedAt: 'desc' }, take: limit });
    res.json(rows.map((r) => forViewer(req, toIncidentEntry(r))));
  } catch (err) { next(err); }
});

raidProtectionRoutes.get('/incidents/:id', requirePermission('clients.kick'), async (req: Request, res: Response, next) => {
  try {
    const { prisma, serverConfigId, sid } = scope(req);
    const [id] = targetIds([req.params.id], 'id');
    const row = await prisma.raidIncident.findFirst({ where: { id, serverConfigId, sid } });
    if (!row) throw new AppError(404, 'Incident not found');
    res.json(forViewer(req, toIncidentEntry(row)));
  } catch (err) { next(err); }
});
