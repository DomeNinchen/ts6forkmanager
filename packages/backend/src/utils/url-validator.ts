import { lookup } from 'dns/promises';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.internal',
]);

const CLOUD_METADATA_IPS = new Set([
  '169.254.169.254',  // AWS, GCP, Azure
  'fd00:ec2::254',    // AWS IPv6
]);

/**
 * Check if an IP address is in a private/reserved range.
 */
export function isPrivateIP(ip: string): boolean {
  // A URL's hostname keeps the brackets around an IPv6 literal ("[::1]"); strip
  // them so the checks below see the bare address. Without this "[::1]" never
  // matched "::1" and localhost over IPv6 slipped through the SSRF filter.
  const bare = ip.replace(/^\[/, '').replace(/\]$/, '');

  // IPv4
  const parts = bare.split('.');
  if (parts.length === 4) {
    const [a, b] = parts.map(Number);
    if (a === 10) return true;                           // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true;    // 172.16.0.0/12
    if (a === 192 && b === 168) return true;              // 192.168.0.0/16
    if (a === 127) return true;                           // 127.0.0.0/8
    if (a === 169 && b === 254) return true;              // 169.254.0.0/16 (link-local)
    if (a === 0) return true;                             // 0.0.0.0/8
  }

  // IPv6
  const lower = bare.toLowerCase();
  if (lower === '::1') return true;                       // loopback
  if (lower.startsWith('fe80:')) return true;              // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
  if (lower.startsWith('::ffff:')) {                      // IPv4-mapped IPv6
    const mapped = lower.slice(7);
    // Dotted form ("::ffff:127.0.0.1") can be checked as plain IPv4. The URL
    // parser, though, rewrites a mapped literal to hex ("::ffff:7f00:1"), so
    // decode those two 16-bit groups back to dotted quad before the check.
    if (mapped.includes('.')) return isPrivateIP(mapped);
    const hex = mapped.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const hi = parseInt(hex[1], 16);
      const lo = parseInt(hex[2], 16);
      return isPrivateIP(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
    }
    return false;
  }

  return false;
}

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
