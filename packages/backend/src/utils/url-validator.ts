import { lookup } from 'dns/promises';
import dns from 'dns';
import http from 'http';
import https from 'https';
import net from 'net';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.internal',
]);

const CLOUD_METADATA_IPS = new Set([
  '169.254.169.254',  // AWS, GCP, Azure
  'fd00:ec2::254',    // AWS IPv6
]);

/** Every address range that is not the public internet. BlockList also matches an
 * IPv4-mapped IPv6 address ("::ffff:127.0.0.1", or the URL parser's hex form
 * "::ffff:7f00:1") against the IPv4 ranges. */
const NON_PUBLIC = new net.BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3],
] as const) NON_PUBLIC.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
] as const) NON_PUBLIC.addSubnet(network, prefix, 'ipv6');

/**
 * Whether an IP address literal is in a private/reserved range. A hostname is not an
 * address and answers false - it has to be resolved first (validateUrl does that).
 */
export function isPrivateIP(ip: string): boolean {
  // A URL's hostname keeps the brackets around an IPv6 literal ("[::1]")
  const bare = ip.replace(/^\[/, '').replace(/\]$/, '');
  const version = net.isIP(bare);
  return version !== 0 && NON_PUBLIC.check(bare, version === 4 ? 'ipv4' : 'ipv6');
}

function isBlockedAddress(address: string): boolean {
  return isPrivateIP(address) || CLOUD_METADATA_IPS.has(address);
}

/**
 * dns.lookup for outgoing requests that refuses a name with any non-public address. It runs
 * when the connection is made - for the first URL and for every redirect after it - so neither a
 * redirect to an internal host nor a name whose answer changed since validateUrl looked at it
 * gets through.
 */
const publicOnlyLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 0);
    const blocked = addresses.find((a) => isBlockedAddress(a.address));
    if (blocked || addresses.length === 0) {
      return callback(Object.assign(new Error(`Hostname "${hostname}" resolves to a private IP`), { code: 'ESSRF' }), '', 0);
    }
    if (options.all) (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
};

/**
 * Axios options for a request to a URL a user chose (after validateUrl said yes). validateUrl only
 * sees the first URL; these hold every hop to the same rules: the agents resolve names through
 * publicOnlyLookup, and a redirect to an address literal - which is never looked up - is checked
 * here. Without them a public URL that answers "307 -> http://<internal host>/" reached that host,
 * method and body included.
 */
export const ssrfSafeAxiosOptions = {
  httpAgent: new http.Agent({ lookup: publicOnlyLookup }),
  httpsAgent: new https.Agent({ lookup: publicOnlyLookup }),
  beforeRedirect: (options: Record<string, any>) => {
    if (!['http:', 'https:'].includes(options.protocol) || isBlockedAddress(String(options.hostname ?? ''))) {
      throw new Error(`Redirect to ${options.protocol}//${options.hostname} blocked`);
    }
  },
};

export interface ValidateUrlOptions {
  allowedProtocols?: string[];
  skipDnsCheck?: boolean;
}

export interface ValidateUrlResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate a URL for safety against SSRF attacks.
 * Blocks private IPs, cloud metadata endpoints, and non-HTTP protocols.
 */
export async function validateUrl(
  url: string,
  options: ValidateUrlOptions = {},
): Promise<ValidateUrlResult> {
  const allowedProtocols = options.allowedProtocols || ['http:', 'https:'];

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }

  // Protocol check
  if (!allowedProtocols.includes(parsed.protocol)) {
    return { valid: false, error: `Protocol "${parsed.protocol}" is not allowed. Use: ${allowedProtocols.join(', ')}` };
  }

  // Hostname checks
  const hostname = parsed.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { valid: false, error: `Hostname "${hostname}" is blocked` };
  }

  if (CLOUD_METADATA_IPS.has(hostname)) {
    return { valid: false, error: 'Cloud metadata endpoint is blocked' };
  }

  // Check if hostname is a literal IP
  if (isPrivateIP(hostname)) {
    return { valid: false, error: 'Private/reserved IP addresses are blocked' };
  }

  // DNS resolution check. Resolve every address the name has, not just the
  // first: a host that answers with both a public and a private address would
  // otherwise slip the private one past this gate. Fail closed - a name we
  // cannot resolve is refused rather than waved through, so an attacker cannot
  // bypass the private-IP check by pointing at a name that fails here but
  // resolves at fetch time.
  if (!options.skipDnsCheck) {
    let addresses: string[];
    try {
      addresses = (await lookup(hostname, { all: true })).map((a) => a.address);
    } catch {
      return { valid: false, error: `Hostname "${hostname}" could not be resolved` };
    }
    if (addresses.length === 0) {
      return { valid: false, error: `Hostname "${hostname}" could not be resolved` };
    }
    for (const address of addresses) {
      if (isPrivateIP(address)) {
        return { valid: false, error: `Hostname "${hostname}" resolves to a private IP (${address})` };
      }
      if (CLOUD_METADATA_IPS.has(address)) {
        return { valid: false, error: `Hostname "${hostname}" resolves to a cloud metadata IP` };
      }
    }
  }

  return { valid: true };
}
