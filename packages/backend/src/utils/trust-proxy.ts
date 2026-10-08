import net from 'net';

/**
 * Which proxies in front of the backend may tell it who the visitor is.
 *
 * The visitor's address is whatever X-Forwarded-For says, but only as far as
 * the proxies that wrote it can be believed: a visitor can send that header
 * too, and the proxies only append to it. So the backend has to know how many
 * proxies (or which addresses) stand between it and the internet - too few and
 * it sees the proxy instead of the visitor, too many and it believes an address
 * the visitor made up. That is what TRUST_PROXY sets, as the value Express
 * takes for its `trust proxy` setting.
 */

export type TrustProxyValue = number | false | string[];

export interface TrustProxySetting {
  value: TrustProxyValue;
  /** The setting in words, for the log and the settings page ("1 proxy hop", "loopback, 10.0.0.0/8"). */
  description: string;
  /** True when TRUST_PROXY was set and understood; false when the built-in default is in use. */
  fromEnv: boolean;
  /** Set when TRUST_PROXY was set but could not be used - the default applies instead. */
  warning?: string;
}

/** What a standard Docker Compose install has: the frontend container's nginx, one hop in front of the backend. */
export const DEFAULT_TRUST_PROXY_HOPS = 1;
export const MAX_TRUST_PROXY_HOPS = 10;

/** Express (proxy-addr) knows these three names for the address ranges of private networks. */
const KEYWORDS = new Set(['loopback', 'linklocal', 'uniquelocal']);

function isIpOrCidr(token: string): boolean {
  const [address, prefix, ...rest] = token.split('/');
  if (rest.length > 0) return false;
  const family = net.isIP(address);
  if (family === 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  return Number(prefix) <= (family === 4 ? 32 : 128);
}

function defaultSetting(warning?: string): TrustProxySetting {
  return { value: DEFAULT_TRUST_PROXY_HOPS, description: describeHops(DEFAULT_TRUST_PROXY_HOPS), fromEnv: false, warning };
}

function describeHops(hops: number): string {
  if (hops === 0) return 'no proxy (the direct connection is the visitor)';
  return hops === 1 ? '1 proxy hop' : `${hops} proxy hops`;
}

/**
 * Reads TRUST_PROXY. Accepted: a number of proxy hops (0-10), `false`/`0` for
 * none, or a comma-separated list of addresses, CIDR ranges and the names
 * `loopback`, `linklocal`, `uniquelocal`. Unset or empty means one hop, which
 * is what the app has always assumed. `true` is refused on purpose - Express
 * would then believe the first entry of the header, which the visitor writes.
 */
export function parseTrustProxy(raw: string | undefined): TrustProxySetting {
  const text = (raw ?? '').trim();
  if (text === '') return defaultSetting();

  const lower = text.toLowerCase();
  if (lower === 'false') return { value: false, description: describeHops(0), fromEnv: true };
  if (lower === 'true') {
    return defaultSetting(
      'TRUST_PROXY=true is refused: it would believe the first entry of X-Forwarded-For, which a visitor can write himself. Use the number of proxies in front of the backend, or a list of their addresses.',
    );
  }

  if (/^\d+$/.test(text)) {
    const hops = Number(text);
    if (hops > MAX_TRUST_PROXY_HOPS) {
      return defaultSetting(`TRUST_PROXY=${text} is more than the ${MAX_TRUST_PROXY_HOPS} proxy hops anyone has in front of this app - using ${DEFAULT_TRUST_PROXY_HOPS}.`);
    }
    return { value: hops, description: describeHops(hops), fromEnv: true };
  }

  const tokens = text.split(',').map((t) => t.trim()).filter((t) => t !== '');
  const invalid = tokens.filter((t) => !KEYWORDS.has(t.toLowerCase()) && !isIpOrCidr(t));
  if (tokens.length === 0 || invalid.length > 0) {
    return defaultSetting(
      `TRUST_PROXY="${text}" is not a number of proxy hops or a list of addresses (invalid: ${invalid.join(', ') || text}) - using ${DEFAULT_TRUST_PROXY_HOPS}.`,
    );
  }
  const list = tokens.map((t) => (KEYWORDS.has(t.toLowerCase()) ? t.toLowerCase() : t));
  return { value: list, description: `proxies at ${list.join(', ')}`, fromEnv: true };
}

// --- Diagnostics: what the backend sees of one request ------------------------

/** The setting as it would be written in `.env`, to show next to what it means. */
export function trustProxyEnvValue(value: TrustProxyValue): string {
  return value === false ? 'false' : Array.isArray(value) ? value.join(',') : String(value);
}

export type AddressScope = 'public' | 'private' | 'loopback' | 'unknown';

/** `::ffff:1.2.3.4` is how Node reports an IPv4 peer on a dual-stack socket. */
export function normalizeAddress(address: string): string {
  const trimmed = address.trim();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(trimmed);
  return mapped ? mapped[1] : trimmed;
}

function ipv4Scope(address: string): AddressScope {
  const [a, b] = address.split('.').map(Number);
  if (a === 127) return 'loopback';
  if (a === 10) return 'private';
  if (a === 172 && b >= 16 && b <= 31) return 'private';
  if (a === 192 && b === 168) return 'private';
  if (a === 169 && b === 254) return 'private';
  // 100.64.0.0/10 is carrier-grade NAT (shared address space): an ISP's, never a visitor's own.
  if (a === 100 && b >= 64 && b <= 127) return 'private';
  if (a === 0) return 'private';
  return 'public';
}

export function addressScope(raw: string): AddressScope {
  const address = normalizeAddress(raw);
  const family = net.isIP(address);
  if (family === 4) return ipv4Scope(address);
  if (family === 6) {
    const lower = address.toLowerCase();
    if (lower === '::1') return 'loopback';
    if (/^f[cd][0-9a-f]{2}:/.test(lower) || /^fe[89ab][0-9a-f]:/.test(lower) || lower === '::') return 'private';
    return 'public';
  }
  return 'unknown';
}

export interface ChainEntry {
  address: string;
  /** `socket`: the connection the backend accepted. `forwarded`: an entry of X-Forwarded-For, nearest to the backend first. */
  origin: 'socket' | 'forwarded';
  scope: AddressScope;
}

/** The addresses a request passed through, nearest to the backend first: the connection itself, then X-Forwarded-For from its last entry back to its first. */
export function buildChain(socketAddress: string | undefined, forwardedFor: string | undefined): ChainEntry[] {
  const chain: ChainEntry[] = [];
  if (socketAddress) {
    const address = normalizeAddress(socketAddress);
    chain.push({ address, origin: 'socket', scope: addressScope(address) });
  }
  const entries = (forwardedFor ?? '')
    .split(',')
    .map((e) => normalizeAddress(e))
    .filter((e) => e !== '');
  for (const address of entries.reverse()) {
    chain.push({ address, origin: 'forwarded', scope: addressScope(address) });
  }
  return chain;
}

/**
 * The number of proxy hops that would make the backend read the visitor's
 * address out of this request: the position of the first public address in the
 * chain, which is how many private ones (the proxies) stand in front of it.
 * Null when the chain has no public address - the page was opened from a
 * private network, where nothing can be said about the proxies.
 */
export function suggestHops(chain: ChainEntry[]): number | null {
  const index = chain.findIndex((entry) => entry.scope === 'public');
  if (index === -1) return null;
  return index;
}
