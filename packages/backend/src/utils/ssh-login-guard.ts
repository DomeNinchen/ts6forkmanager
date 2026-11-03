import crypto from 'crypto';

/**
 * Query-ban protection for SSH logins. TS6 blocks SSH for a non-allowlisted address after its second
 * failed login, for minutes, and then refuses the right password too (measured on 6.0.0-beta13.1,
 * R10). So a refused login is remembered per credentials (only a hash is kept), and the connection
 * test never tries the same credentials again; changed credentials or a backend restart allow one
 * new attempt. Test logins to one target are also spaced by TEST_LOGIN_INTERVAL_MS.
 */
export interface SshCredentials { host: string; port: number; username: string; password: string }

export const TEST_LOGIN_INTERVAL_MS = 30_000;

const rejected = new Map<string, { message: string; at: Date }>();
const lastTestLogin = new Map<string, number>();

function credentialKey(c: SshCredentials): string {
  return crypto.createHash('sha256').update(JSON.stringify([c.host.toLowerCase(), c.port, c.username, c.password])).digest('hex');
}

export function rememberSshRejection(c: SshCredentials, message: string): void {
  rejected.set(credentialKey(c), { message, at: new Date() });
}

export function forgetSshRejection(c: SshCredentials): void {
  rejected.delete(credentialKey(c));
}

export function sshRejection(c: SshCredentials): { message: string; at: Date } | undefined {
  return rejected.get(credentialKey(c));
}

/** Claims the next test login for host:port; returns the seconds to wait when one ran too recently. */
export function claimTestLogin(host: string, port: number, now = Date.now()): number {
  const key = `${host.toLowerCase()}:${port}`;
  const last = lastTestLogin.get(key);
  if (last !== undefined && now - last < TEST_LOGIN_INTERVAL_MS) return Math.ceil((TEST_LOGIN_INTERVAL_MS - (now - last)) / 1000);
  lastTestLogin.set(key, now);
  return 0;
}
