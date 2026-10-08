import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import maxmind, { type Reader } from 'maxmind';
import type {
  ConnectionJournalGeo,
  ConnectionJournalGeoIpStatus,
  GeoIpEdition,
  GeoIpErrorCode,
} from '@ts6/common';
import type { PrismaClient } from '../generated/prisma/client.js';
import { addressScope, normalizeAddress } from './trust-proxy.js';

/**
 * The GeoIP lookup behind the Connection Journal's country column: an MMDB file on
 * the backend's own disk, read in memory - no address ever leaves the machine.
 *
 * Where the file comes from is the admin's choice (Connection Journal -> Settings):
 *  - DB-IP's free "Lite" databases (Country, about 4 MB, or City, about 60 MB
 *    compressed and 120 MB read into memory), downloaded on request - or, if
 *    switched on, once a month - from download.db-ip.com. Their licence is CC BY 4.0
 *    and asks for a link back wherever the data is shown (the page has it).
 *  - a file the admin uploads: a MaxMind GeoLite2 database they hold the licence
 *    for, say. Nothing is bundled with the app or fetched from MaxMind: their
 *    licence does not allow passing the database on.
 * The app asks for no account and sends nothing about itself; the download is a
 * plain GET of one file.
 */

export const GEOIP_BASE_URL = 'https://download.db-ip.com/free/';
/** The compressed City file is about 60 MB; this only stops a runaway response. */
const MAX_DOWNLOAD_BYTES = 300 * 1024 * 1024;
/** The City database is about 120 MB uncompressed. */
export const MAX_UPLOAD_BYTES = 450 * 1024 * 1024;
const UPDATE_CHECK_MS = 6 * 60 * 60 * 1000;
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;
const BACKFILL_BATCH = 200;
const BACKFILL_PAUSE_MS = 25;
const KEY_EDITION = 'geoip_edition';
const KEY_AUTO_UPDATE = 'geoip_auto_update';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class GeoIpError extends Error {
  constructor(readonly code: GeoIpErrorCode, readonly detail: string) {
    super(`${code}: ${detail}`);
  }
}

interface GeoIpMeta {
  source: 'dbip' | 'custom';
  edition: GeoIpEdition | 'custom';
  /** DB-IP's release month ("2026-10"); null for a custom file. */
  version: string | null;
  databaseType: string;
  builtAt: string | null;
  installedAt: string;
  sizeBytes: number;
  /** The name of the file an admin uploaded. */
  originalName?: string;
}

// --- Pure helpers (also used by the checks) --------------------------------------------------

/** "2026-10", in UTC: DB-IP publishes its monthly files on the 1st. */
export function monthOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function previousMonth(month: string): string {
  const [year, m] = month.split('-').map(Number);
  return m === 1 ? `${year - 1}-12` : `${year}-${String(m - 1).padStart(2, '0')}`;
}

export function dbipFileName(edition: GeoIpEdition, month: string): string {
  return `dbip-${edition}-lite-${month}.mmdb.gz`;
}

/** Is a newer release (or another edition) to be fetched for an installation that has switched the monthly update on? */
export function needsUpdate(meta: Pick<GeoIpMeta, 'source' | 'edition' | 'version'> | null, selected: GeoIpEdition, now: Date): boolean {
  // Only what the app downloaded itself is kept up to date; a file the admin uploaded is theirs.
  if (!meta || meta.source !== 'dbip') return false;
  return meta.edition !== selected || (meta.version ?? '') < monthOf(now);
}

/** A database result as the journal stores it: "" for nothing found, the fields the database has otherwise. */
export function geoOf(result: any): { country: string; region: string | null; city: string | null } {
  const country = typeof result?.country?.iso_code === 'string' ? result.country.iso_code : '';
  if (country === '') return { country: '', region: null, city: null };
  const region = result?.subdivisions?.[0]?.names?.en;
  const city = result?.city?.names?.en;
  return { country, region: typeof region === 'string' ? region : null, city: typeof city === 'string' ? city : null };
}

/**
 * Whose data the page has to credit: DB-IP asks for a link back wherever its data is shown (CC BY 4.0), and
 * a MaxMind GeoLite2 file the admin uploaded comes with the line "This product includes GeoLite data
 * created by MaxMind" - the file says which it is, whoever put it there.
 */
export function attributionOf(meta: Pick<GeoIpMeta, 'source' | 'databaseType'> | null): 'dbip' | 'maxmind' | null {
  if (!meta) return null;
  if (meta.source === 'dbip' || /dbip/i.test(meta.databaseType)) return 'dbip';
  if (/geolite|geoip2/i.test(meta.databaseType)) return 'maxmind';
  return null;
}

export function toGeo(row: { country: string | null; region: string | null; city: string | null }): ConnectionJournalGeo | null {
  return row.country ? { country: row.country, region: row.region, city: row.city } : null;
}

// --- The service --------------------------------------------------------------------------------

export interface GeoIpOptions {
  /** Where the database lives; the backend's data directory by default. */
  dir?: string;
  baseUrl?: string;
  now?: () => Date;
  fetchImpl?: typeof fetch;
  updateCheckMs?: number;
}

export class GeoIpService {
  private readonly dir: string;
  private readonly baseUrl: string;
  private readonly now: () => Date;
  private readonly fetchImpl: typeof fetch;
  private readonly updateCheckMs: number;

  private reader: Reader<any> | null = null;
  private meta: GeoIpMeta | null = null;
  private settings: { edition: GeoIpEdition; autoUpdate: boolean } = { edition: 'country', autoUpdate: false };
  private state: ConnectionJournalGeoIpStatus['state'] = 'idle';
  private progress: ConnectionJournalGeoIpStatus['progress'] = null;
  private lastCheckAt: Date | null = null;
  private lastError: ConnectionJournalGeoIpStatus['lastError'] = null;
  private backfillState = { running: false, done: 0, total: 0 };
  private timer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  constructor(private readonly prisma: PrismaClient, options: GeoIpOptions = {}) {
    this.dir = options.dir ?? path.resolve('data/geoip');
    this.baseUrl = options.baseUrl ?? GEOIP_BASE_URL;
    this.now = options.now ?? (() => new Date());
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.updateCheckMs = options.updateCheckMs ?? UPDATE_CHECK_MS;
  }

  private get currentPath() { return path.join(this.dir, 'current.mmdb'); }
  private get metaPath() { return path.join(this.dir, 'meta.json'); }
  get incomingPath() { return path.join(this.dir, 'incoming.tmp'); }
  /** Where an uploaded file is put until it has been looked at. */
  get uploadDir() { return this.dir; }

  async start(): Promise<void> {
    fs.mkdirSync(this.dir, { recursive: true });
    await this.loadSettings();
    await this.loadInstalled();
    if (this.destroyed) return;
    this.timer = setInterval(() => void this.checkAutoUpdate(), this.updateCheckMs);
    this.timer.unref?.();
    void this.checkAutoUpdate();
    void this.backfill();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // --- Looking up -------------------------------------------------------------------------------

  /** Null when there is no database (the address is not looked up); otherwise what the journal stores for it. */
  lookup(ipRaw: string): { country: string; region: string | null; city: string | null } | null {
    if (!this.reader) return null;
    const ip = normalizeAddress(ipRaw);
    // A private, loopback or malformed address is not in any database: nothing to look up, and not an error.
    if (addressScope(ip) !== 'public' || !maxmind.validate(ip)) return { country: '', region: null, city: null };
    try {
      return geoOf(this.reader.get(ip));
    } catch {
      return { country: '', region: null, city: null };
    }
  }

  get installed(): boolean {
    return this.reader !== null;
  }

  // --- Settings ----------------------------------------------------------------------------------

  private async loadSettings(): Promise<void> {
    try {
      const rows = await this.prisma.appSetting.findMany({ where: { key: { in: [KEY_EDITION, KEY_AUTO_UPDATE] } } });
      const stored = new Map(rows.map((r) => [r.key, r.value]));
      const edition = stored.get(KEY_EDITION);
      this.settings = {
        edition: edition === 'city' ? 'city' : 'country',
        autoUpdate: stored.get(KEY_AUTO_UPDATE) === 'true',
      };
    } catch (err: any) {
      console.warn(`[GeoIP] Could not read the settings, using the defaults: ${err.message}`);
    }
  }

  async setSettings(values: { edition: GeoIpEdition; autoUpdate: boolean }): Promise<void> {
    const pairs: Array<[string, string]> = [[KEY_EDITION, values.edition], [KEY_AUTO_UPDATE, String(values.autoUpdate)]];
    await this.prisma.$transaction(
      pairs.map(([key, value]) => this.prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } })),
    );
    this.settings = { ...values };
    // Switching the update on (or choosing another edition with it on) is acted on now, not at the next pass.
    void this.checkAutoUpdate();
  }

  // --- What is installed -----------------------------------------------------------------------------

  private async loadInstalled(): Promise<void> {
    try {
      if (!fs.existsSync(this.currentPath) || !fs.existsSync(this.metaPath)) return;
      const meta = JSON.parse(fs.readFileSync(this.metaPath, 'utf8')) as GeoIpMeta;
      this.reader = await maxmind.open(this.currentPath);
      this.meta = meta;
      console.log(`[GeoIP] Loaded ${meta.databaseType}${meta.version ? ` ${meta.version}` : ''} (${meta.source})`);
    } catch (err: any) {
      this.reader = null;
      this.meta = null;
      console.warn(`[GeoIP] The installed database cannot be read and is ignored: ${err.message}`);
    }
  }

  /**
   * Makes the file at `tempPath` the database, if it is one: a readable MMDB with country or city
   * data. The file is moved into place (not copied) and the old one replaced in one step.
   */
  async installFile(tempPath: string, info: { source: GeoIpMeta['source']; edition: GeoIpMeta['edition']; version: string | null; originalName?: string }): Promise<void> {
    this.state = 'installing';
    try {
      let reader: Reader<any>;
      try {
        reader = await maxmind.open(tempPath);
        reader.get('8.8.8.8'); // a damaged tree shows itself here
      } catch (err: any) {
        throw new GeoIpError('invalid-file', err.message ?? 'not an MMDB file');
      }
      const databaseType = String(reader.metadata.databaseType ?? '');
      if (!/country|city/i.test(databaseType) || /asn/i.test(databaseType)) {
        throw new GeoIpError('not-a-geo-database', databaseType || 'unknown database type');
      }

      const built: any = reader.metadata.buildEpoch;
      const builtAt = built instanceof Date ? built : typeof built === 'number' ? new Date(built * 1000) : null;
      const meta: GeoIpMeta = {
        source: info.source,
        edition: info.edition,
        version: info.version,
        databaseType,
        builtAt: builtAt && !Number.isNaN(builtAt.getTime()) ? builtAt.toISOString() : null,
        installedAt: this.now().toISOString(),
        sizeBytes: fs.statSync(tempPath).size,
        ...(info.originalName ? { originalName: info.originalName } : {}),
      };

      fs.mkdirSync(this.dir, { recursive: true });
      fs.renameSync(tempPath, this.currentPath);
      const metaTmp = `${this.metaPath}.tmp`;
      fs.writeFileSync(metaTmp, JSON.stringify(meta, null, 2));
      fs.renameSync(metaTmp, this.metaPath);
      this.reader = reader;
      this.meta = meta;
      this.lastError = null;
      console.log(`[GeoIP] Installed ${databaseType}${meta.version ? ` ${meta.version}` : ''} (${meta.source}, ${(meta.sizeBytes / 1_048_576).toFixed(1)} MB)`);
    } finally {
      this.state = 'idle';
      fs.rmSync(tempPath, { force: true });
    }
    void this.backfill();
  }

  /** An admin's own file; a gzipped one is unpacked first. */
  async installUpload(tempPath: string, originalName: string): Promise<void> {
    const head = Buffer.alloc(2);
    const fd = fs.openSync(tempPath, 'r');
    try { fs.readSync(fd, head, 0, 2, 0); } finally { fs.closeSync(fd); }
    let file = tempPath;
    if (head[0] === 0x1f && head[1] === 0x8b) {
      file = `${tempPath}.unpacked`;
      try {
        await pipeline(fs.createReadStream(tempPath), zlib.createGunzip(), fs.createWriteStream(file));
      } catch (err: any) {
        fs.rmSync(file, { force: true });
        fs.rmSync(tempPath, { force: true });
        throw new GeoIpError('invalid-file', err.message);
      }
      fs.rmSync(tempPath, { force: true });
    }
    await this.installFile(file, { source: 'custom', edition: 'custom', version: null, originalName });
  }

  async remove(): Promise<void> {
    this.reader = null;
    this.meta = null;
    fs.rmSync(this.currentPath, { force: true });
    fs.rmSync(this.metaPath, { force: true });
    this.lastError = null;
    console.log('[GeoIP] The database was removed');
  }

  // --- Downloading ---------------------------------------------------------------------------------------

  get busy(): boolean {
    return this.state !== 'idle';
  }

  /**
   * Fetches this month's DB-IP file of the edition (last month's if it is not published yet) and
   * installs it. Throws a GeoIpError; the same error is kept for the status.
   */
  async download(edition: GeoIpEdition): Promise<void> {
    if (this.busy) throw new GeoIpError('download-failed', 'a download or installation is already running');
    this.state = 'downloading';
    this.progress = { receivedBytes: 0, totalBytes: null };
    this.lastError = null;
    this.lastCheckAt = this.now();
    const tmp = this.incomingPath;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const thisMonth = monthOf(this.now());
      let found: string | null = null;
      for (const month of [thisMonth, previousMonth(thisMonth)]) {
        const url = `${this.baseUrl}${dbipFileName(edition, month)}`;
        let res: Response;
        try {
          res = await this.fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS), headers: { 'user-agent': 'ts6-manager (GeoIP database download)' } });
        } catch (err: any) {
          throw new GeoIpError('download-failed', err.message ?? String(err));
        }
        if (res.status === 404) continue;
        if (!res.ok || !res.body) throw new GeoIpError('download-failed', `HTTP ${res.status}`);

        const total = Number(res.headers.get('content-length'));
        this.progress = { receivedBytes: 0, totalBytes: Number.isFinite(total) && total > 0 ? total : null };
        if (this.progress.totalBytes !== null && this.progress.totalBytes > MAX_DOWNLOAD_BYTES) throw new GeoIpError('too-large', `${total} bytes`);
        const body = Readable.fromWeb(res.body as any);
        body.on('data', (chunk: Buffer) => {
          this.progress!.receivedBytes += chunk.length;
          if (this.progress!.receivedBytes > MAX_DOWNLOAD_BYTES) body.destroy(new GeoIpError('too-large', `more than ${MAX_DOWNLOAD_BYTES} bytes`));
        });
        try {
          await pipeline(body, zlib.createGunzip(), fs.createWriteStream(tmp));
        } catch (err: any) {
          throw err instanceof GeoIpError ? err : new GeoIpError('download-failed', err.message ?? String(err));
        }
        found = month;
        break;
      }
      if (!found) throw new GeoIpError('not-published', dbipFileName(edition, thisMonth));

      this.progress = null;
      await this.installFile(tmp, { source: 'dbip', edition, version: found });
    } catch (err) {
      const e = err instanceof GeoIpError ? err : new GeoIpError('download-failed', err instanceof Error ? err.message : String(err));
      this.lastError = { code: e.code, detail: e.detail };
      console.warn(`[GeoIP] Download of the ${edition} database failed: ${e.message}`);
      throw e;
    } finally {
      this.state = 'idle';
      this.progress = null;
      fs.rmSync(tmp, { force: true });
    }
  }

  /** The monthly update, if it is switched on and one is due. Never throws. */
  async checkAutoUpdate(): Promise<void> {
    if (this.destroyed || !this.settings.autoUpdate || this.busy) return;
    if (!needsUpdate(this.meta, this.settings.edition, this.now())) return;
    try {
      await this.download(this.settings.edition);
    } catch {
      // Kept in lastError; tried again at the next pass (a release is not on the server in the first hours of the month).
    }
  }

  // --- Entries recorded before there was a database ---------------------------------------------------------

  /**
   * Looks up the addresses of the journal rows that have not been looked up yet, in small blocks so
   * the database stays responsive. Safe to start twice.
   */
  async backfill(): Promise<void> {
    if (!this.reader || this.backfillState.running) return;
    this.backfillState = { running: true, done: 0, total: 0 };
    try {
      const pending = await this.prisma.connectionJournalEntry.groupBy({ by: ['ip'], where: { country: null } });
      this.backfillState.total = pending.length;
      if (pending.length === 0) return;
      for (;;) {
        if (this.destroyed || !this.reader) return;
        const block = await this.prisma.connectionJournalEntry.groupBy({ by: ['ip'], where: { country: null }, orderBy: { ip: 'asc' }, take: BACKFILL_BATCH });
        if (block.length === 0) return;
        for (const { ip } of block) {
          const geo = this.lookup(ip) ?? { country: '', region: null, city: null };
          await this.prisma.connectionJournalEntry.updateMany({ where: { ip, country: null }, data: geo });
        }
        this.backfillState.done += block.length;
        await sleep(BACKFILL_PAUSE_MS);
      }
    } catch (err: any) {
      console.warn(`[GeoIP] Looking up the older journal entries stopped: ${err.message}`);
    } finally {
      this.backfillState.running = false;
    }
  }

  // --- Status for the page ---------------------------------------------------------------------------------------

  status(): ConnectionJournalGeoIpStatus {
    const meta = this.meta;
    return {
      installed: this.reader !== null,
      source: meta?.source ?? null,
      edition: meta?.edition ?? null,
      version: meta?.version ?? null,
      databaseType: meta?.databaseType ?? null,
      builtAt: meta?.builtAt ?? null,
      installedAt: meta?.installedAt ?? null,
      sizeBytes: meta?.sizeBytes ?? null,
      selectedEdition: this.settings.edition,
      autoUpdate: this.settings.autoUpdate,
      state: this.state,
      progress: this.progress ? { ...this.progress } : null,
      lastCheckAt: this.lastCheckAt ? this.lastCheckAt.toISOString() : null,
      lastError: this.lastError,
      backfill: { ...this.backfillState },
      attribution: attributionOf(meta),
    };
  }
}
