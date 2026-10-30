import type { Request, Response, NextFunction } from 'express';
import { roleHasPermission, type UserPermission } from '@ts6/common';

/**
 * Default-deny access for a router mounted in app.ts.
 *
 * `adminExcept(open)` lets an admin through and refuses every other role - except for the
 * requests listed in `open`, each for the roles that hold the permission it names (ROLE_PERMISSIONS
 * in @ts6/common). So what a non-admin can reach on a mount is the list at that mount in app.ts
 * and nothing else: a route added to the router later, with or without a check of its own, is
 * admin-only until someone opens it there on purpose.
 *
 * The checks inside the routers stay as a second layer. A router can narrow what its
 * mount allows, never widen it.
 */

/** For an open route every signed-in user may call whatever their role (their own settings, the theme). */
export const SIGNED_IN = 'signed-in' as const;

export interface OpenRoute {
  /** A HEAD request counts as GET (Express answers it with the GET handler). */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | '*';
  /**
   * The path below the mount: '/' is the mount itself, ':name' matches one segment, and a
   * trailing '/*' matches everything below (use it only for a router that is meant to be
   * reachable as a whole with that permission).
   */
  path: string;
  /** What a role needs to hold for this request. */
  permission: UserPermission | typeof SIGNED_IN;
}

interface CompiledRoute {
  method: OpenRoute['method'];
  pattern: RegExp;
  permission: OpenRoute['permission'];
}

function compile(route: OpenRoute): CompiledRoute {
  let source: string;
  if (route.path === '/') {
    source = '/';
  } else if (route.path.endsWith('/*')) {
    source = escapeSegments(route.path.slice(0, -2)) + '(?:/.*)?';
  } else {
    source = escapeSegments(route.path);
  }
  return { method: route.method, pattern: new RegExp(`^${source}$`), permission: route.permission };
}

function escapeSegments(path: string): string {
  return path
    .split('/')
    .map((segment) => (segment.startsWith(':') ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
}

/** '/a/b/' and '/a/b' are one path, '' and '//' are the root - the same way Express's non-strict routing sees them. */
function normalize(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

export function adminExcept(open: readonly OpenRoute[] = []) {
  const routes = open.map(compile);
  return (req: Request, res: Response, next: NextFunction) => {
    const role = req.user?.role;
    if (!role) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    if (role === 'admin') return next();

    const method = req.method === 'HEAD' ? 'GET' : req.method;
    const path = normalize(req.path);
    // The patterns are case-sensitive on purpose: Express routes /Tokens like /tokens, so a
    // differently cased spelling of an open path is refused here - failing closed.
    const allowed = routes.some((r) => (r.method === '*' || r.method === method) && r.pattern.test(path)
      && (r.permission === SIGNED_IN || roleHasPermission(role, r.permission)));
    if (!allowed) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}
