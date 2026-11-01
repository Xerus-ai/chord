import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Fail-closed behaviour of the access middleware. A production server that
 * merely lacked DATABASE_URL once served every request with authorization
 * disabled; the bypass is DEV_MODE alone and an unavailable database REJECTS.
 * Role decisions against a real database are covered by the sharing route
 * tests (routes/sharing/__tests__).
 */

interface Recorded {
  res: Response;
  statusCode: number | null;
}

function recordResponse(): Recorded {
  const recorded = { statusCode: null } as Recorded;
  recorded.res = {
    status(code: number) {
      recorded.statusCode = code;
      return recorded.res;
    },
    json() {
      return recorded.res;
    },
  } as unknown as Response;
  return recorded;
}

function request(params: Record<string, string>): Request {
  return {
    params,
    user: { userId: 'user_1', orgId: null, email: 'u@x.dev', permissions: [], sessionId: 's' },
  } as unknown as Request;
}

async function importMiddleware(env: Record<string, string>) {
  vi.resetModules();
  vi.stubEnv('WORKOS_CLIENT_ID', 'client_test');
  vi.stubEnv('DEV_MODE', '');
  vi.stubEnv('DATABASE_URL', '');
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return await import('./access-middleware.js');
}

async function run(
  middleware: (req: Request, res: Response, next: NextFunction) => void,
  req: Request
): Promise<{ statusCode: number | null; nextCalled: boolean }> {
  const recorded = recordResponse();
  let nextCalled = false;
  middleware(req, recorded.res, () => {
    nextCalled = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  return { statusCode: recorded.statusCode, nextCalled };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('access middleware without a database', () => {
  it('rejects a work item check with 500 and never calls next', async () => {
    const mod = await importMiddleware({});
    const result = await run(mod.requireWorkItemRole('view'), request({ work_item_id: 'w1' }));
    expect(result).toEqual({ statusCode: 500, nextCalled: false });
  });

  it('rejects an artifact check with 500 and never calls next', async () => {
    const mod = await importMiddleware({});
    const result = await run(
      mod.requireArtifactRole('view'),
      request({ work_item_id: 'w1', artifact_id: 'a1' })
    );
    expect(result).toEqual({ statusCode: 500, nextCalled: false });
  });
});

describe('access middleware in DEV_MODE', () => {
  it('admits as author and still attaches the access the handlers read', async () => {
    const mod = await importMiddleware({ DEV_MODE: 'true' });
    const req = request({ work_item_id: 'w1', artifact_id: 'a1' });

    expect(await run(mod.requireWorkItemRole('author'), req)).toEqual({
      statusCode: null,
      nextCalled: true,
    });
    expect(await run(mod.requireArtifactRole('author'), req)).toEqual({
      statusCode: null,
      nextCalled: true,
    });
    expect(mod.workItemAccessOf(req).role).toBe('author');
    expect(mod.artifactAccessOf(req).role).toBe('author');
  });
});
