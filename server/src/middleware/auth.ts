import { eq } from 'drizzle-orm';
import type { NextFunction, Request, Response } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { db, hasDb } from '../db/client.js';
import { users } from '../db/schema.js';

export interface AuthClaims {
  userId: string;
  orgId: string | null;
  role: string | null;
  email: string;
  permissions: string[];
  sessionId: string;
}

export interface AuthenticatedRequest extends Request {
  user: AuthClaims;
}

interface WorkOSJWTPayload extends JWTPayload {
  sub: string;
  sid: string;
  org_id?: string;
  role?: string;
  permissions?: string[];
}

const clientId = process.env.WORKOS_CLIENT_ID;
const isProduction = process.env.NODE_ENV === 'production';
const explicitDevMode = process.env.DEV_MODE === 'true';

// DEV_MODE is an explicit opt-in, never an accidental fallback: it requires
// both a non-production NODE_ENV and DEV_MODE=true. Missing WorkOS config
// without that explicit flag is a misconfiguration, not a reason to run with
// auth disabled — fail fast instead of silently turning every request into
// an authenticated admin.
export const DEV_MODE = !isProduction && explicitDevMode;

if (!DEV_MODE && !clientId) {
  throw new Error(
    isProduction
      ? '[auth] WORKOS_CLIENT_ID is required when NODE_ENV=production. Refusing to start with auth disabled.'
      : '[auth] WORKOS_CLIENT_ID is not set. Set WORKOS_CLIENT_ID for real auth, or set DEV_MODE=true for local development.'
  );
}

const DEV_USER: AuthClaims = {
  userId: 'dev-user-local',
  orgId: 'dev-org-local',
  role: 'admin',
  email: 'dev@localhost',
  permissions: ['*'],
  sessionId: 'dev-session',
};

const JWKS = clientId
  ? createRemoteJWKSet(new URL(`https://api.workos.com/sso/jwks/${clientId}`))
  : null;

function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const parts = header.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null;
  return parts[1] ?? null;
}

export async function verifyAccessToken(token: string): Promise<AuthClaims> {
  if (DEV_MODE) return DEV_USER;

  const { payload } = await jwtVerify(token, JWKS!, {
    issuer: `https://api.workos.com/user_management/${clientId}`,
  });

  const claims = payload as WorkOSJWTPayload;

  if (!claims.sub) {
    throw new Error('Token missing sub claim');
  }

  return {
    userId: claims.sub,
    orgId: claims.org_id ?? null,
    role: claims.role ?? null,
    email: '',
    permissions: claims.permissions ?? [],
    sessionId: claims.sid,
  };
}

async function upsertUser(claims: AuthClaims): Promise<AuthClaims> {
  if (!hasDb) return claims;

  const [existing] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, claims.userId))
    .limit(1);

  if (existing) {
    return { ...claims, email: existing.email };
  }

  await db
    .insert(users)
    .values({
      id: claims.userId,
      email: `${claims.userId}@pending`,
      name: null,
      avatar_url: null,
    })
    .onConflictDoNothing();

  const [inserted] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, claims.userId))
    .limit(1);

  return { ...claims, email: inserted?.email ?? '' };
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (DEV_MODE) {
    (req as AuthenticatedRequest).user = DEV_USER;
    next();
    return;
  }

  const token = extractBearerToken(req.headers.authorization);

  if (!token) {
    res.status(401).json({ error: 'Missing authorization header' });
    return;
  }

  verifyAccessToken(token)
    .then((claims) => upsertUser(claims))
    .then((claims) => {
      (req as AuthenticatedRequest).user = claims;
      next();
    })
    .catch((err) => {
      console.error('[auth] JWT verification failed:', err.message);
      res.status(401).json({ error: 'Invalid or expired token' });
    });
}

export async function authenticateWebSocket(token: string): Promise<AuthClaims> {
  if (DEV_MODE) return DEV_USER;
  const claims = await verifyAccessToken(token);
  return upsertUser(claims);
}
