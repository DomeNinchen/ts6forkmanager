import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { nanoid } from 'nanoid';
import { config } from '../config.js';
import { authMiddleware } from '../middleware/auth.js';
import { AppError } from '../middleware/error-handler.js';
import { validatePassword } from '../utils/validate-password.js';
import { issueTokensForUser } from '../utils/issue-tokens.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import {
  generateTotpSecret, generateTotpQrCode, verifyTotpCode,
  generateRecoveryCodes, hashRecoveryCode, verifyRecoveryCode,
} from '../utils/totp.js';

const TOTP_TICKET_PURPOSE = '2fa-pending';
const TRUSTED_DEVICE_DAYS = 15;

export const authRoutes: Router = Router();

authRoutes.post('/login', async (req: Request, res: Response, next) => {
  try {
    const { username, password, deviceToken } = req.body;
    if (!username || !password) throw new AppError(400, 'Username and password required');

    const prisma = req.app.locals.prisma;
    const user = await prisma.user.findUnique({ where: { username } });

    // SSO-only accounts (authProvider 'oidc') have no passwordHash at all -
    // there's nothing to compare against, so they simply can't use this route.
    if (!user || !user.enabled || !user.passwordHash) throw new AppError(401, 'Invalid credentials');

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new AppError(401, 'Invalid credentials');

    if (user.totpEnabled) {
      // A device that already completed a TOTP challenge recently doesn't need
      // to do it again on every login - it just needs a valid, unexpired token.
      if (deviceToken) {
        const trusted = await prisma.trustedDevice.findUnique({ where: { token: deviceToken } });
        if (trusted && trusted.userId === user.id && trusted.expiresAt > new Date()) {
          const { accessToken, refreshToken } = await issueTokensForUser(prisma, user);
          res.json({
            accessToken, refreshToken,
            user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role, authProvider: user.authProvider, totpEnabled: user.totpEnabled },
          });
          return;
        }
      }

      // Password checked out, but the second factor is still needed - hand back
      // a short-lived ticket identifying this half-completed login instead of tokens.
      const ticket = jwt.sign({ purpose: TOTP_TICKET_PURPOSE, userId: user.id }, config.jwtSecret, { expiresIn: '5m' });
      res.json({ requiresTotp: true, ticket });
      return;
    }

    const { accessToken, refreshToken } = await issueTokensForUser(prisma, user);

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        authProvider: user.authProvider,
        totpEnabled: user.totpEnabled,
      },
    });
  } catch (err) { next(err); }
});

authRoutes.post('/login/verify-totp', async (req: Request, res: Response, next) => {
  try {
    const { ticket, code, rememberDevice } = req.body;
    if (!ticket || !code) throw new AppError(400, 'Ticket and code required');

    let payload: any;
    try {
      payload = jwt.verify(ticket, config.jwtSecret);
    } catch {
      throw new AppError(401, 'This login attempt has expired - please log in again');
    }
    if (payload.purpose !== TOTP_TICKET_PURPOSE) throw new AppError(401, 'Invalid ticket');

    const prisma = req.app.locals.prisma;
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user || !user.enabled || !user.totpEnabled || !user.totpSecret) throw new AppError(401, 'Invalid credentials');

    let ok = await verifyTotpCode(decrypt(user.totpSecret), code);
    if (!ok) {
      // Not a valid TOTP code right now - maybe it's a one-time recovery code instead.
      const unused = await prisma.recoveryCode.findMany({ where: { userId: user.id, usedAt: null } });
      for (const rc of unused) {
        if (await verifyRecoveryCode(code, rc.codeHash)) {
          await prisma.recoveryCode.update({ where: { id: rc.id }, data: { usedAt: new Date() } });
          ok = true;
          break;
        }
      }
    }
    if (!ok) throw new AppError(401, 'Invalid code');

    const { accessToken, refreshToken } = await issueTokensForUser(prisma, user);

    let deviceToken: string | undefined;
    if (rememberDevice) {
      deviceToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + TRUSTED_DEVICE_DAYS);
      await prisma.trustedDevice.create({ data: { token: deviceToken, userId: user.id, expiresAt } });
    }

    res.json({
      accessToken,
      refreshToken,
      deviceToken,
      user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role, totpEnabled: user.totpEnabled },
    });
  } catch (err) { next(err); }
});

authRoutes.post('/refresh', async (req: Request, res: Response, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) throw new AppError(400, 'Refresh token required');

    const prisma = req.app.locals.prisma;
    const stored = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (!stored) {
      // H5: Token not found — check if it was already used (reuse detection)
      const replaced = await prisma.refreshToken.findFirst({
        where: { replacedBy: refreshToken },
      });
      if (replaced) {
        // Reuse detected! Revoke entire token family
        console.warn(`[SECURITY] Refresh token reuse detected for user ${replaced.userId}. Revoking all tokens.`);
        await prisma.refreshToken.deleteMany({ where: { userId: replaced.userId } });
      }
      throw new AppError(401, 'Invalid refresh token');
    }

    if (stored.expiresAt < new Date() || !stored.user.enabled) {
      await prisma.refreshToken.delete({ where: { id: stored.id } });
      throw new AppError(401, 'Invalid refresh token');
    }

    // Rotate: mark old token as replaced, create new one in same family.
    // Two concurrent refresh requests can both read the same `stored` row
    // above before either mutates it. Claim it with a conditional update
    // (only succeeds if nobody has rotated it yet) instead of an
    // unconditional one, so the losing request gets a clean "already
    // refreshed" 401 instead of crashing on a Prisma "record not found"
    // when it later tries to update/delete a row the winner already removed.
    const newRefreshToken = crypto.randomBytes(64).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const claimed = await prisma.refreshToken.updateMany({
      where: { id: stored.id, replacedBy: null },
      data: { replacedBy: newRefreshToken },
    });
    if (claimed.count === 0) {
      throw new AppError(401, 'Refresh token already used');
    }

    await prisma.refreshToken.create({
      data: { token: newRefreshToken, userId: stored.userId, expiresAt, family: stored.family },
    });

    // Delete old token after creating new one
    await prisma.refreshToken.delete({ where: { id: stored.id } });

    const payload = { id: stored.user.id, username: stored.user.username, role: stored.user.role };
    const accessToken = jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtAccessExpiry } as jwt.SignOptions);

    res.json({ accessToken, refreshToken: newRefreshToken });
  } catch (err) { next(err); }
});

authRoutes.post('/logout', async (req: Request, res: Response, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      const prisma = req.app.locals.prisma;
      await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
    }
    res.status(204).send();
  } catch (err) { next(err); }
});

authRoutes.get('/me', authMiddleware, async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw new AppError(404, 'User not found');

    res.json({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        authProvider: user.authProvider,
        totpEnabled: user.totpEnabled,
      },
    });
  } catch (err) { next(err); }
});

// --- Two-factor authentication (TOTP) ---

authRoutes.post('/totp/setup', authMiddleware, async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw new AppError(404, 'User not found');
    if (user.totpEnabled) throw new AppError(400, '2FA is already enabled');

    const secret = generateTotpSecret();
    await prisma.user.update({ where: { id: user.id }, data: { totpSecret: encrypt(secret) } });

    const qrCodeDataUrl = await generateTotpQrCode(secret, user.username);
    res.json({ secret, qrCodeDataUrl });
  } catch (err) { next(err); }
});

authRoutes.post('/totp/verify-setup', authMiddleware, async (req: Request, res: Response, next) => {
  try {
    const { code } = req.body;
    if (!code) throw new AppError(400, 'Code required');

    const prisma = req.app.locals.prisma;
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user || !user.totpSecret) throw new AppError(400, 'Start setup first');
    if (user.totpEnabled) throw new AppError(400, '2FA is already enabled');

    const ok = await verifyTotpCode(decrypt(user.totpSecret), code);
    if (!ok) throw new AppError(400, 'Invalid code');

    await prisma.user.update({ where: { id: user.id }, data: { totpEnabled: true } });

    // Clear out any codes left over from an earlier, abandoned setup attempt.
    await prisma.recoveryCode.deleteMany({ where: { userId: user.id } });
    const codes = generateRecoveryCodes();
    await prisma.recoveryCode.createMany({
      data: await Promise.all(codes.map(async (c) => ({ userId: user.id, codeHash: await hashRecoveryCode(c) }))),
    });

    res.json({ recoveryCodes: codes });
  } catch (err) { next(err); }
});

authRoutes.post('/totp/disable', authMiddleware, async (req: Request, res: Response, next) => {
  try {
    const { password } = req.body;
    if (!password) throw new AppError(400, 'Current password required');

    const prisma = req.app.locals.prisma;
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user || !user.passwordHash) throw new AppError(404, 'User not found');

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new AppError(401, 'Current password is incorrect');

    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { totpEnabled: false, totpSecret: null } }),
      prisma.recoveryCode.deleteMany({ where: { userId: user.id } }),
      prisma.trustedDevice.deleteMany({ where: { userId: user.id } }),
    ]);

    res.status(204).send();
  } catch (err) { next(err); }
});

authRoutes.put('/password', authMiddleware, async (req: Request, res: Response, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) throw new AppError(400, 'Both passwords required');

    const pwError = validatePassword(newPassword);
    if (pwError) throw new AppError(400, pwError);

    const prisma = req.app.locals.prisma;
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw new AppError(404, 'User not found');

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new AppError(401, 'Current password is incorrect');

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

    // Revoke all refresh tokens on password change
    await prisma.refreshToken.deleteMany({ where: { userId: user.id } });

    res.status(204).send();
  } catch (err) { next(err); }
});
