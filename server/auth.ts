import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { getDb } from './db.ts';

export type StaffRole = 'SUPER_ADMIN' | 'MANAGER' | 'CASHIER' | 'KITCHEN_STAFF' | 'PENDING';

export interface DbUserRow {
  uid: string;
  username: string;
  displayName: string;
  passwordHash: string;
  role: StaffRole;
  isActive: number;
  createdAt: number;
  updatedAt: number;
}

export interface AuthenticatedUser {
  uid: string;
  username: string;
  displayName: string;
  role: StaffRole;
  isActive: boolean;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

const RUNTIME_SESSION_SECRET =
  process.env.SESSION_SECRET?.trim() || crypto.randomBytes(32).toString('hex');

const TOKEN_TTL_MS = 1000 * 60 * 60 * 16; // 16 hours shift session

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidUsername(username: string): boolean {
  return /^[a-z0-9_.-]{3,32}$/.test(username);
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;

  const expectedBuf = Buffer.from(expectedHex, 'hex');
  const actualBuf = crypto.scryptSync(password, salt, 64);
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

export function timingSafeEqualString(a: string, b: string): boolean {
  const digestA = crypto.createHash('sha256').update(a).digest();
  const digestB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

export function getEnvAdminConfig(): { username: string; password: string } | null {
  const password = process.env.POS_ADMIN_PASSWORD ?? '';
  if (!password) return null;
  const username = normalizeUsername(process.env.POS_ADMIN_USERNAME || 'admin') || 'admin';
  return { username, password };
}

export function signSessionToken(user: AuthenticatedUser): string {
  const payload = {
    uid: user.uid,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', RUNTIME_SESSION_SECRET)
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string): {
  uid: string;
  username: string;
  displayName: string;
  role: StaffRole;
  exp: number;
} | null {
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0) return null;
  const encoded = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  if (!encoded || !sig) return null;

  const expectedSig = crypto
    .createHmac('sha256', RUNTIME_SESSION_SECRET)
    .update(encoded)
    .digest('base64url');

  const sigBuf = Buffer.from(sig, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload?.uid || !payload?.username || typeof payload?.exp !== 'number') {
      return null;
    }
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function toPublicProfile(row: DbUserRow) {
  return {
    id: row.uid,
    uid: row.uid,
    username: row.username,
    email: row.username,
    displayName: row.displayName,
    role: row.role,
    isActive: row.isActive === 1,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  const token = authHeader.slice(7).trim();
  const payload = verifySessionToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired session. Please sign in again.' });
    return;
  }

  const db = getDb();
  const userRow = db
    .prepare('SELECT * FROM users WHERE uid = ?')
    .get(payload.uid) as DbUserRow | undefined;

  if (userRow) {
    if (userRow.isActive !== 1 || userRow.role === 'PENDING') {
      res.status(403).json({ error: 'Account is suspended or pending activation.' });
      return;
    }
    req.user = {
      uid: userRow.uid,
      username: userRow.username,
      displayName: userRow.displayName,
      role: userRow.role,
      isActive: true,
    };
    next();
    return;
  }

  // Fallback for env-configured admin across stateless serverless instances
  const envAdmin = getEnvAdminConfig();
  if (envAdmin && payload.uid === 'usr_env_admin' && payload.username === envAdmin.username) {
    req.user = {
      uid: payload.uid,
      username: envAdmin.username,
      displayName: 'Store Admin',
      role: 'SUPER_ADMIN',
      isActive: true,
    };
    next();
    return;
  }

  res.status(401).json({ error: 'User account not found. Please sign in again.' });
}

export function requireRoles(...allowed: StaffRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!allowed.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient role permissions for this action.' });
      return;
    }
    next();
  };
}
