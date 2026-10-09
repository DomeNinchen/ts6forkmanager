import net from 'node:net';
import type { IncomingMessage } from 'node:http';
import express, { type Express, type Request } from 'express';
import type { WebSocket, WebSocketServer } from 'ws';
import {
  BAN_DURATION_MAX,
  BAN_REASON_MAX_LENGTH,
  type BanCheck,
  type BanProtection,
  type CreateWebBanRequest,
  type IpBanErrorCode,
  type JournalBanState,
  type WebIpBanDto,
  type WebIpBanList,
} from '@ts6/common';
import type { PrismaClient } from '../generated/prisma/client.js';
import { config } from '../config.js';
import { AppError } from '../middleware/error-handler.js';
import { clientIpOf } from './connection-journal.js';
import type { GeoIpService } from './geoip.js';
import { addressScope, normalizeAddress } from './trust-proxy.js';

/**
 * Addresses the web interface turns away. A ban answers every request from the address with
 * 403 - the whole API and the WebSocket, only /api/health stays open - and ends by itself
 * when its time is up. The list is kept in memory (this process is the only writer), so a
 * request costs one map lookup; counting what a ban turned away is batched into the database.
 *
 * Three guards keep an admin from locking themselves out: the address a request comes from, this
 * machine and private networks cannot be banned at all (behind a proxy that is not set up right
 * every visitor looks like a private address), an address an admin signed in from in the last
 * week needs a second confirmation, and IP_BANS_DISABLED=true switches the whole thing off from
 * outside the interface.
 */

const PURGE_EVERY_MS = 60 * 60 * 1000;
const FLUSH_EVERY_MS = 10_000;
const ADMIN_ADDRESS_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The one form of an address bans are compared in: IPv4-mapped IPv6 unwrapped, IPv6 in its compressed lower-case form. */
export function canonicalAddress(raw: string): string {
  const address = normalizeAddress(raw);
  if (net.isIP(address) !== 6) return address;
  try {
    return new URL(`http://[${address}]/`).hostname.replace(/^\[|\]$/g, '');
  } catch {
    // A zone id (fe80::1%eth0) is not a URL host; the lower-case form still compares well enough.
    return address.toLowerCase();
  }
}

/**
 * The address the backend takes for the visitor of a WebSocket upgrade. An upgrade never
 * becomes an Express request, so it is run through Express's own `req.ip` getter: the
 * same TRUST_PROXY rule, not a second copy of it.
 */
export function clientIpOfUpgrade(app: Express, req: IncomingMessage): string {
  const probe = Object.create(express.request) as Request;
  Object.assign(probe, { app, headers: req.headers, socket: req.socket, connection: req.socket });
  return clientIpOf({ ip: probe.ip, socket: req.socket });
}

interface ActiveBan {
  id: number;
  /** Epoch ms; null = until lifted. */
  expiresAt: number | null;
}

type TrackedSocket = WebSocket & { clientIp?: string };

function banError(status: number, code: IpBanErrorCode, message: string): AppError {
  return new AppError(status, message, undefined, code);
}

export class IpBanService {
  private active = new Map<string, ActiveBan>();
  private pending = new Map<string, { count: number; lastAt: number }>();
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private prisma: PrismaClient,
    private app: Express,
    private wss: WebSocketServer,
    private geo?: GeoIpService,
  ) {}

  get disabled(): boolean {
    return config.ipBansDisabled;
  }

  async start(): Promise<void> {
    await this.purgeExpired();
    await this.load();
    // The address of every socket, to be able to close the ones of an address that gets banned.
    this.wss.on('connection', (socket, req) => {
      (socket as TrackedSocket).clientIp = canonicalAddress(clientIpOfUpgrade(this.app, req));
    });
    this.timers.push(setInterval(() => void this.purgeExpired(), PURGE_EVERY_MS));
    this.timers.push(setInterval(() => void this.flush(), FLUSH_EVERY_MS));
    for (const timer of this.timers) timer.unref?.();
    if (this.disabled) console.warn('[IpBans] IP_BANS_DISABLED is set: no address is turned away, whatever the ban list says');
    else if (this.active.size > 0) console.log(`[IpBans] ${this.active.size} address(es) banned`);
  }

  async destroy(): Promise<void> {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    await this.flush();
  }

  private async load(): Promise<void> {
    const rows = await this.prisma.ipBan.findMany({ where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
    this.active.clear();
    for (const row of rows) this.active.set(canonicalAddress(row.ip), { id: row.id, expiresAt: row.expiresAt ? row.expiresAt.getTime() : null });
  }

  // --- The check every request goes through -------------------------------------------------

  /** Whether this address is turned away right now. */
  isBlocked(ip: string): boolean {
    if (this.disabled || this.active.size === 0) return false;
    return this.activeBan(canonicalAddress(ip)) !== null;
  }

  private activeBan(canonical: string): ActiveBan | null {
    const ban = this.active.get(canonical);
    if (!ban) return null;
    if (ban.expiresAt !== null && ban.expiresAt <= Date.now()) {
      this.active.delete(canonical);
      return null;
    }
    return ban;
  }

  /** A request was turned away; counted on the ban's row with the next batch. */
  noteBlocked(ip: string): void {
    const key = canonicalAddress(ip);
    const entry = this.pending.get(key);
    if (entry) {
      entry.count += 1;
      entry.lastAt = Date.now();
    } else {
      this.pending.set(key, { count: 1, lastAt: Date.now() });
    }
  }

  /** The ban that covers an address, for the journal's badge (also while the emergency switch is on - the list is still the list). */
  webBanOf(ip: string): JournalBanState['web'] {
    const canonical = canonicalAddress(ip);
    const ban = this.activeBan(canonical);
    return ban ? { id: ban.id, expiresAt: ban.expiresAt === null ? null : new Date(ban.expiresAt).toISOString() } : null;
  }

  // --- What the admin sees ---------------------------------------------------------------------

  async list(): Promise<WebIpBanList> {
    await this.flush();
    const rows = await this.prisma.ipBan.findMany({
      where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      orderBy: { createdAt: 'desc' },
    });
    return { disabled: this.disabled, bans: rows.map((row) => this.toDto(row)) };
  }

  private toDto(row: {
    id: number; ip: string; reason: string | null; createdAt: Date; expiresAt: Date | null;
    createdBy: string; blockedCount: number; lastBlockedAt: Date | null;
  }): WebIpBanDto {
    const place = this.geo?.lookup(row.ip) ?? null;
    return {
      id: row.id,
      ip: row.ip,
      scope: addressScope(row.ip),
      geo: place && place.country ? { country: place.country, region: place.region, city: place.city } : null,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      createdBy: row.createdBy,
      blockedCount: row.blockedCount,
      lastBlockedAt: row.lastBlockedAt ? row.lastBlockedAt.toISOString() : null,
    };
  }

  // --- The guards ---------------------------------------------------------------------------------

  /** What stands between this address and a ban, for the dialog (and, again, for the ban itself). */
  async check(ip: string, actingIp: string): Promise<BanCheck> {
    const canonical = canonicalAddress(ip);
    const scope = addressScope(canonical);
    let protection: BanProtection | null = null;
    if (net.isIP(canonical) === 0) protection = 'invalid';
    else if (canonical === canonicalAddress(actingIp)) protection = 'own';
    else if (scope === 'loopback') protection = 'loopback';
    else if (scope === 'private') protection = 'private';
    return {
      ip: canonical,
      protection,
      adminAccounts: protection === null ? await this.adminsFrom(ip, canonical) : [],
      webBan: this.webBanOf(canonical),
      disabled: this.disabled,
    };
  }

  /** Admin accounts that completed a sign-in from this address in the last week. */
  private async adminsFrom(ip: string, canonical: string): Promise<string[]> {
    const admins = await this.prisma.user.findMany({ where: { role: 'admin' }, select: { username: true } });
    if (admins.length === 0) return [];
    const rows = await this.prisma.connectionJournalEntry.findMany({
      where: {
        source: 'web',
        result: 'success',
        ip: { in: Array.from(new Set([ip, canonical])) },
        at: { gte: new Date(Date.now() - ADMIN_ADDRESS_DAYS * DAY_MS) },
        username: { in: admins.map((a) => a.username) },
      },
      select: { username: true, event: true, reason: true },
      take: 500,
    });
    // "Password right, second factor still needed" is not yet a sign-in.
    const names = rows.filter((r) => !(r.event === 'login' && r.reason === 'totp-required')).map((r) => r.username as string);
    return Array.from(new Set(names));
  }

  /** Throws the answer the interface words when this address must not (or not without a second yes) be banned. */
  async assertBannable(ip: string, actingIp: string, confirmAdmin: boolean): Promise<BanCheck> {
    const check = await this.check(ip, actingIp);
    switch (check.protection) {
      case 'invalid': throw banError(400, 'ban-invalid-address', 'That is not an IP address');
      case 'own': throw banError(403, 'ban-protected-own', 'This is the address you are using right now - banning it would lock you out');
      case 'loopback': throw banError(403, 'ban-protected-loopback', 'This is the machine the backend runs on');
      case 'private': throw banError(403, 'ban-protected-private', 'This is an address in a private network; behind a proxy that is not set up right, every visitor looks like this');
    }
    if (check.adminAccounts.length > 0 && !confirmAdmin) {
      throw banError(409, 'ban-confirm-admin', `An admin (${check.adminAccounts.join(', ')}) signed in from this address in the last ${ADMIN_ADDRESS_DAYS} days`);
    }
    return check;
  }

  // --- Setting and lifting ---------------------------------------------------------------------

  async create(request: CreateWebBanRequest, by: string, actingIp: string): Promise<WebIpBanDto> {
    if (this.disabled) throw banError(409, 'bans-disabled', 'IP bans are switched off (IP_BANS_DISABLED is set)');
    const check = await this.assertBannable(request.ip, actingIp, request.confirmAdmin === true);
    const duration = parseBanDuration(request.duration);
    const reason = parseBanReason(request.reason);
    const expiresAt = duration === 0 ? null : new Date(Date.now() + duration * 1000);
    const row = await this.prisma.ipBan.upsert({
      where: { ip: check.ip },
      create: { ip: check.ip, reason, expiresAt, createdBy: by },
      // Banning an address that is banned already renews the ban: new time, reason and author, the count of what it turned away stays.
      update: { reason, expiresAt, createdBy: by, createdAt: new Date() },
    });
    this.active.set(check.ip, { id: row.id, expiresAt: expiresAt ? expiresAt.getTime() : null });
    console.log(`[IpBans] ${by} banned ${check.ip} ${expiresAt ? `until ${expiresAt.toISOString()}` : 'until lifted'}${reason ? ` (${reason})` : ''}`);
    this.closeSocketsOf(check.ip);
    return this.toDto(row);
  }

  async remove(id: number, by: string): Promise<boolean> {
    const row = await this.prisma.ipBan.findUnique({ where: { id } });
    if (!row) return false;
    await this.prisma.ipBan.delete({ where: { id } });
    this.active.delete(canonicalAddress(row.ip));
    this.pending.delete(canonicalAddress(row.ip));
    console.log(`[IpBans] ${by} lifted the ban on ${row.ip}`);
    return true;
  }

  /** The WebSocket connections of a banned address are closed with it; they could not be opened again anyway. */
  private closeSocketsOf(ip: string): void {
    for (const client of this.wss.clients) {
      if ((client as TrackedSocket).clientIp === ip) client.close(4403, 'Address blocked');
    }
  }

  // --- Housekeeping ----------------------------------------------------------------------------------

  async purgeExpired(): Promise<number> {
    try {
      const { count } = await this.prisma.ipBan.deleteMany({ where: { expiresAt: { lte: new Date() } } });
      for (const [ip, ban] of this.active) {
        if (ban.expiresAt !== null && ban.expiresAt <= Date.now()) this.active.delete(ip);
      }
      if (count > 0) console.log(`[IpBans] ${count} ban(s) ran out`);
      return count;
    } catch (err: any) {
      console.warn(`[IpBans] Removing the bans that ran out failed: ${err.message}`);
      return 0;
    }
  }

  /** Writes what the bans turned away since the last time. */
  async flush(): Promise<void> {
    if (this.pending.size === 0) return;
    const batch = this.pending;
    this.pending = new Map();
    try {
      for (const [ip, entry] of batch) {
        // updateMany: the ban may have been lifted since, and then there is nothing to count on.
        await this.prisma.ipBan.updateMany({
          where: { ip },
          data: { blockedCount: { increment: entry.count }, lastBlockedAt: new Date(entry.lastAt) },
        });
      }
    } catch (err: any) {
      console.warn(`[IpBans] Counting the blocked requests failed: ${err.message}`);
    }
  }
}

/** Seconds from the request body: 0 (until lifted) or a whole number up to ten years. */
export function parseBanDuration(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > BAN_DURATION_MAX) {
    throw new AppError(400, 'duration must be 0 (until lifted) or a number of seconds');
  }
  return value;
}

export function parseBanReason(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') throw new AppError(400, 'reason must be text');
  const text = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, BAN_REASON_MAX_LENGTH);
  return text === '' ? null : text;
}
