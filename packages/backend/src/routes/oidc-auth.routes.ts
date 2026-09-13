/**
 * OIDC / SSO login (e.g. Authentik, Keycloak, Authelia, Zitadel - any
 * standard OpenID Connect provider). All three routes here are public
 * (unauthenticated) by necessity - they ARE the login flow.
 *
 * No server-side session/cookie is used to carry PKCE/state/nonce across the
 * redirect to the IdP and back - instead they're bundled into a short-lived
 * JWT (signed with the same JWT_SECRET already used everywhere else in this
 * app) and passed as the `state` parameter itself, which the IdP echoes back
 * verbatim. This avoids introducing cookies into an otherwise fully
 * Bearer-token-based app just for this one flow.
 */

import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import * as client from 'openid-client';
import { config } from '../config.js';
import { getOidcConfig } from '../utils/oidc-config.js';
import { getOidcClientConfig } from '../utils/oidc-client.js';
import { issueTokensForUser } from '../utils/issue-tokens.js';

export const oidcAuthRoutes: Router = Router();

const REDIRECT_URI = () => `${config.frontendUrl}/api/auth/oidc/callback`;

interface OAuthStatePayload {
  codeVerifier: string;
  nonce: string;
}

// GET /api/auth/oidc/status - lets the Login page know whether to show an SSO button at all
oidcAuthRoutes.get('/status', async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const oidc = await getOidcConfig(prisma);
    res.json({ enabled: oidc.enabled && !!oidc.issuer && !!oidc.clientId, buttonLabel: oidc.buttonLabel });
  } catch (err) { next(err); }
});

oidcAuthRoutes.get('/login', async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const oidc = await getOidcConfig(prisma);
    if (!oidc.enabled || !oidc.issuer || !oidc.clientId) {
      return res.redirect(`${config.frontendUrl}/login?error=sso_not_configured`);
    }

    const clientConfig = await getOidcClientConfig(oidc);

    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
    const nonce = client.randomNonce();
    const state: OAuthStatePayload = { codeVerifier, nonce };
    const stateToken = jwt.sign(state, config.jwtSecret, { expiresIn: '10m' });

    const authUrl = client.buildAuthorizationUrl(clientConfig, {
      redirect_uri: REDIRECT_URI(),
      scope: 'openid email profile',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state: stateToken,
      nonce,
    });

    res.redirect(authUrl.href);
  } catch (err) {
    console.error('[OIDC] /login failed:', (err as Error).message);
    res.redirect(`${config.frontendUrl}/login?error=sso_failed`);
  }
});

oidcAuthRoutes.get('/callback', async (req: Request, res: Response) => {
  const prisma = req.app.locals.prisma;
  try {
    const oidc = await getOidcConfig(prisma);
    if (!oidc.enabled || !oidc.issuer || !oidc.clientId) {
      return res.redirect(`${config.frontendUrl}/login?error=sso_not_configured`);
    }

    const stateToken = String(req.query.state || '');
    let statePayload: OAuthStatePayload;
    try {
      statePayload = jwt.verify(stateToken, config.jwtSecret) as OAuthStatePayload;
    } catch {
      return res.redirect(`${config.frontendUrl}/login?error=sso_invalid_state`);
    }

    const clientConfig = await getOidcClientConfig(oidc);
    const currentUrl = new URL(`${config.frontendUrl}${req.originalUrl}`);

    const tokens = await client.authorizationCodeGrant(clientConfig, currentUrl, {
      pkceCodeVerifier: statePayload.codeVerifier,
      expectedState: stateToken,
      expectedNonce: statePayload.nonce,
    });

    const claims = tokens.claims();
    if (!claims?.sub) {
      return res.redirect(`${config.frontendUrl}/login?error=sso_no_subject`);
    }

    const email = typeof claims.email === 'string' ? claims.email : undefined;
    const displayName =
      (typeof claims.name === 'string' && claims.name) ||
      (typeof claims.preferred_username === 'string' && claims.preferred_username) ||
      email || claims.sub;

    // Matched strictly by the IdP's stable "sub" claim, never by email - an
    // email-based match would let anyone who controls a matching address at
    // ANY IdP "become" an existing local account. A returning user gets a
    // new account here even if a local one with the same email already
    // exists; linking the two is a deliberate admin action, not automatic.
    let user = await prisma.user.findUnique({ where: { externalId: claims.sub } });

    if (!user) {
      // Username must be unique and is user-facing - prefer the email, fall
      // back to a namespaced sub so two IdP users who both lack an email
      // claim can't collide.
      const baseUsername = email || `oidc:${claims.sub}`;
      let username = baseUsername;
      let suffix = 1;
      while (await prisma.user.findUnique({ where: { username } })) {
        username = `${baseUsername}-${++suffix}`;
      }

      user = await prisma.user.create({
        data: {
          username,
          email,
          externalId: claims.sub,
          authProvider: 'oidc',
          displayName,
          role: 'viewer', // admin promotes explicitly afterward - see Settings > Users
        },
      });
    } else if (!user.enabled) {
      return res.redirect(`${config.frontendUrl}/login?error=account_disabled`);
    }

    const { accessToken, refreshToken } = await issueTokensForUser(prisma, user);

    // Tokens travel in the URL fragment (#), not the query string - fragments
    // are never sent to the server on subsequent requests or logged
    // server-side, unlike query params. This matches the app's existing
    // localStorage-based token storage, which already accepts the same
    // "no httpOnly cookie" tradeoff (see auth.store.ts).
    res.redirect(`${config.frontendUrl}/auth/callback#access_token=${accessToken}&refresh_token=${refreshToken}`);
  } catch (err) {
    console.error('[OIDC] /callback failed:', (err as Error).message);
    res.redirect(`${config.frontendUrl}/login?error=sso_failed`);
  }
});
