import crypto from 'crypto';

/**
 * Query-ban protection for SSH logins. TS6 blocks SSH for a non-allowlisted address after its second
 * failed login, for minutes, and then refuses the right password too (measured on 6.0.0-beta13.1,
 * R10). So a refused login is remembered per credentials (only a hash is kept), and no login path
 * (SshQueryClient.connect) tries the same credentials again; changed credentials or a backend
 * restart allow one new attempt. Test logins to one target are also spaced by TEST_LOGIN_INTERVAL_MS.
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

const loginsInFlight = new Map<string, Promise<unknown>>();

/**
 * Runs one login per credentials at a time, so parallel connections (event session, command
 * listeners, journal) cannot each spend a failed login before the first refusal is remembered.
 */
export async function oneLoginAtATime<T>(c: SshCredentials, login: () => Promise<T>): Promise<T> {
  const key = credentialKey(c);
  const run = (loginsInFlight.get(key) ?? Promise.resolve()).then(login);
  const tail = run.catch(() => {});
  loginsInFlight.set(key, tail);
  try {
    return await run;
  } finally {
    if (loginsInFlight.get(key) === tail) loginsInFlight.delete(key);
  }
}

/** Claims the next test login for host:port; returns the seconds to wait when one ran too recently. */
export function claimTestLogin(host: string, port: number, now = Date.now()): number {
  const key = `${host.toLowerCase()}:${port}`;
  const last = lastTestLogin.get(key);
  if (last !== undefined && now - last < TEST_LOGIN_INTERVAL_MS) return Math.ceil((TEST_LOGIN_INTERVAL_MS - (now - last)) / 1000);
  lastTestLogin.set(key, now);
  return 0;
}
