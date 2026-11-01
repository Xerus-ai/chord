import type { NextFunction, Request, Response } from 'express';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AuthClaims } from './auth.js';

/**
 * Route-level tests for the authorization middleware. These exist because of
 * a shipped fail-open: every guard read `if (DEV_MODE || !hasDb)` and a
 * production server that merely lacked DATABASE_URL served every request
 * with authorization disabled. The bypass must be gated on DEV_MODE alone,
 * and an unavailable database must REJECT, never admit.
 *
 * DEV_MODE and hasDb are read at import time, so each scenario stubs its env
 * and imports a fresh module registry.
 */

function claims(userId: string): AuthClaims {
  return {
    userId,
    orgId: 'org_1',
    role: 'member',
    email: `${userId}@example.com`,
    permissions: [],
    sessionId: `session_${userId}`,
  };
}

interface FakeResponse {
  res: Response;
  statusCode: number | null;
  body: unknown;
}

function fakeRes(): FakeResponse {
  const holder = { statusCode: null, body: null } as unknown as FakeResponse;
  holder.res = {
    status(code: number) {
      holder.statusCode = code;
      return holder.res;
    },
    json(payload: unknown) {
      holder.body = payload;
      return holder.res;
    },
  } as unknown as Response;
  return holder;
}

function fakeReq(overrides: Record<string, unknown>): Request {
  return { params: {}, ...overrides } as unknown as Request;
}

async function importAccessControl(env: Record<string, string>) {
  vi.resetModules();
  // WORKOS_CLIENT_ID keeps middleware/auth.ts's own fail-fast quiet in the
  // non-DEV_MODE scenarios; it plays no further part in these tests.
  vi.stubEnv('WORKOS_CLIENT_ID', 'client_test');
  vi.stubEnv('DEV_MODE', '');
  vi.stubEnv('DATABASE_URL', '');
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }
  return await import('./access-control.js');
}

/** Flushes the promise chain the middleware runs its DB work on. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

// The first import transforms the server module graph, which under the
// parallel suite took ~5 s: inside a test it hit the 5 s test timeout
// (devstation-4cd). Done once here, under the project's 60 s hook timeout;
// each scenario's import after vi.resetModules() then reuses the transforms.
beforeAll(async () => {
  await importAccessControl({});
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('requireOrgMembership without a database', () => {
  it('rejects with 500 and never calls next — an unavailable DB must fail closed', async () => {
    const mod = await importAccessControl({});
    const recorder = fakeRes();
    let nextCalled = false;

    mod.requireOrgMembership(
      fakeReq({ params: { org_id: 'org_1' }, user: claims('user_1') }),
      recorder.res,
      (() => {
        nextCalled = true;
      }) as NextFunction
    );
    await settle();

    expect(nextCalled).toBe(false);
    expect(recorder.statusCode).toBe(500);
  });
});

describe('DEV_MODE bypass', () => {
  it('is gated on DEV_MODE alone and still populates orgMembership', async () => {
    const mod = await importAccessControl({ DEV_MODE: 'true' });
    const recorder = fakeRes();
    let nextCalled = false;
    const req = fakeReq({ params: { org_id: 'org_x' }, user: claims('user_1') });

    mod.requireOrgMembership(req, recorder.res, (() => {
      nextCalled = true;
    }) as NextFunction);
    await settle();

    expect(nextCalled).toBe(true);
    expect(recorder.statusCode).toBeNull();
    const membership = (req as unknown as { orgMembership: { org_id: string; role: string } })
      .orgMembership;
    expect(membership.org_id).toBe('org_x');
    expect(membership.role).toBe('owner');
  });
});
