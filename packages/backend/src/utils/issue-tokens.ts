import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { nanoid } from 'nanoid';
import type { PrismaClient } from '../generated/prisma/client.js';
import { config } from '../config.js';

/** Shared by /auth/login and the OIDC callback - both end with "this user is now authenticated, issue them a fresh token pair". */
export async function issueTokensForUser(
  prisma: PrismaClient,
  user: { id: number; username: string; role: string },
): Promise<{ accessToken: string; refreshToken: string }> {
  const payload = { id: user.id, username: user.username, role: user.role };
  const accessToken = jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtAccessExpiry } as jwt.SignOptions);
  const refreshToken = crypto.randomBytes(64).toString('hex');
  const family = nanoid();

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  await prisma.refreshToken.create({
    data: { token: refreshToken, userId: user.id, expiresAt, family },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  return { accessToken, refreshToken };
}
