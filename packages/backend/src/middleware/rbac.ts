import { Request, Response, NextFunction } from 'express';
import type { UserPermission, UserRole } from '@ts6/common';
import { mayRole } from '../utils/role-table.js';

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    if (!(roles as readonly string[]).includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}

/** Lets an admin through, and every other role that holds the permission (utils/role-table.ts). */
export function requirePermission(permission: UserPermission) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    if (req.user.role !== 'admin' && !mayRole(req.user.role, permission)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}
