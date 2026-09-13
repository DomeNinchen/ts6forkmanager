import * as client from 'openid-client';
import type { OidcConfig } from './oidc-config.js';

// Discovery hits the IdP's .well-known/openid-configuration over the network -
// cache the resulting Configuration rather than re-discovering on every
// login/callback request. Keyed by the settings that actually affect it, so
// an admin changing issuer/clientId/clientSecret in Settings -> SSO
// transparently invalidates this on the next request instead of needing a
// backend restart.
let cached: { key: string; config: client.Configuration } | null = null;

export async function getOidcClientConfig(cfg: OidcConfig): Promise<client.Configuration> {
  const key = `${cfg.issuer}|${cfg.clientId}|${cfg.clientSecret}`;
  if (cached && cached.key === key) return cached.config;

  const config = await client.discovery(new URL(cfg.issuer), cfg.clientId, cfg.clientSecret);
  cached = { key, config };
  return config;
}
