import { generateSecret, generateURI, verify } from 'otplib';
import QRCode from 'qrcode';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

const ISSUER = 'TS6 Manager';
const RECOVERY_CODE_COUNT = 10;

export function generateTotpSecret(): string {
  return generateSecret();
}

export async function generateTotpQrCode(secret: string, username: string): Promise<string> {
  const uri = generateURI({ issuer: ISSUER, label: username, secret });
  return QRCode.toDataURL(uri);
}

export async function verifyTotpCode(secret: string, token: string): Promise<boolean> {
  if (!/^\d{6}$/.test(token)) return false;
  const result = await verify({ secret, token, epochTolerance: 30 });
  return result.valid;
}

/** Plaintext, human-typeable recovery codes (e.g. "a1b2c-3d4e5") - shown to the user exactly once. */
export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    const raw = crypto.randomBytes(5).toString('hex');
    return `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
  });
}

export async function hashRecoveryCode(code: string): Promise<string> {
  return bcrypt.hash(code, 10);
}

export async function verifyRecoveryCode(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(code, hash);
}
