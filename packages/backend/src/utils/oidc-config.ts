import type { PrismaClient } from '../generated/prisma/client.js';
import { encrypt, decrypt } from './crypto.js';

export interface OidcConfig {
  enabled: boolean;
  issuer: string;
  clientId: string;
  /** Encrypted at rest (see crypto.ts) - decrypted only by getOidcConfig(), never returned to the frontend as-is. */
  clientSecret: string;
  /** Shown on the Login page's SSO button, e.g. "Sign in with Authentik". */
  buttonLabel: string;
}

const DB_KEY = 'oidc_config';

const DEFAULT_CONFIG: OidcConfig = {
  enabled: false,
  issuer: '',
  clientId: '',
  clientSecret: '',
  buttonLabel: 'Sign in with SSO',
};

export async function getOidcConfig(prisma: PrismaClient): Promise<OidcConfig> {
  const row = await prisma.appSetting.findUnique({ where: { key: DB_KEY } });
  if (!row) return { ...DEFAULT_CONFIG };
  try {
    const stored = JSON.parse(row.value);
    return {
      ...DEFAULT_CONFIG,
      ...stored,
      clientSecret: stored.clientSecret ? decrypt(stored.clientSecret) : '',
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function setOidcConfig(prisma: PrismaClient, config: OidcConfig): Promise<void> {
  const toStore = { ...config, clientSecret: config.clientSecret ? encrypt(config.clientSecret) : '' };
  await prisma.appSetting.upsert({
    where: { key: DB_KEY },
    create: { key: DB_KEY, value: JSON.stringify(toStore) },
    update: { value: JSON.stringify(toStore) },
  });
}
