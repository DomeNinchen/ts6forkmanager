import { Request, Response, NextFunction } from 'express';
import { roleHasPermission, type UserPermission, type UserRole } from '@ts6/common';

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}

/** Lets an admin through, and every other role that holds the permission (ROLE_PERMISSIONS in @ts6/common). */
export function requirePermission(permission: UserPermission) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    if (req.user.role !== 'admin' && !roleHasPermission(req.user.role, permission)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}
