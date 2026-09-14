// "Remember this device" token for the 2FA login challenge - stored per-username since
// it has to be readable at the login screen, before the main (post-login) auth store exists.
const PREFIX = 'ts6-2fa-device-';

export function getDeviceToken(username: string): string | undefined {
  try {
    const raw = localStorage.getItem(PREFIX + username);
    if (!raw) return undefined;
    const { token, expiresAt } = JSON.parse(raw);
    if (!token || new Date(expiresAt) <= new Date()) {
      localStorage.removeItem(PREFIX + username);
      return undefined;
    }
    return token;
  } catch {
    return undefined;
  }
}

export function setDeviceToken(username: string, token: string, expiresInDays: number): void {
  try {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);
    localStorage.setItem(PREFIX + username, JSON.stringify({ token, expiresAt: expiresAt.toISOString() }));
  } catch {
    // localStorage unavailable - not remembering the device just means the next
    // login asks for a TOTP code again, no functional break.
  }
}
