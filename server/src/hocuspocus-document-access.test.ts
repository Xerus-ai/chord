import { randomUUID } from 'node:crypto';
import type { inArray as InArrayFn } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Database } from './db/client.js';
import type { ServerSchema } from './db/server-schema.js';
import { createTestDatabase } from './db/test-database.js';
import type { resolveDocumentAccess as ResolveDocumentAccessFn } from './hocuspocus.js';
import type { AuthClaims } from './middleware/auth.js';

/**
 * Per-document authorization for the Yjs sync server against a real database:
 * a page artifact (render_class = 'page') has no collaboration document, so
 * the sync server must refuse to open one; a document artifact still resolves
 * to the caller's work-item role. Env is stubbed before the dynamic imports
 * because client.ts and auth.ts read it at import time.
 */
describe('resolveDocumentAccess (real DB)', () => {
  const testDb = createTestDatabase();
  vi.stubEnv('DATABASE_URL', testDb.url);
  vi.stubEnv('WORKOS_CLIENT_ID', 'client_test');
  vi.stubEnv('DEV_MODE', ''); // force real access checks, not the owner bypass

  let db: Database;
  let s: ServerSchema;
  let inArray: typeof InArrayFn;
  let resolveDocumentAccess: typeof ResolveDocumentAccessFn;

  const created = { users: [] as string[], orgs: [] as string[], workItems: [] as string[] };

  beforeAll(async () => {
    await testDb.start();
    db = (await import('./db/client.js')).db;
    ({ serverSchema: s } = await import('./db/server-schema.js'));
    ({ inArray } = await import('drizzle-orm'));
    ({ resolveDocumentAccess } = await import('./hocuspocus.js'));
  });

  afterAll(async () => {
    if (created.workItems.length) {
      await db.delete(s.workItems).where(inArray(s.workItems.id, created.workItems));
    }
    if (created.orgs.length) {
      await db.delete(s.organizations).where(inArray(s.organizations.id, created.orgs));
    }
    if (created.users.length) {
      await db.delete(s.users).where(inArray(s.users.id, created.users));
    }
    await testDb.stop();
  });

  const CONTENT_TYPE_BY_RENDER_CLASS = { document: 'markdown', page: 'web', file: 'document' };

  async function makeArtifact(
    renderClass: 'document' | 'page' | 'file'
  ): Promise<{ claims: AuthClaims; artifactId: string }> {
    const userId = randomUUID();
    await db.insert(s.users).values({ id: userId, email: `${userId}@test.example.com` });
    created.users.push(userId);

    const orgId = randomUUID();
    await db.insert(s.organizations).values({ id: orgId, name: 'test-org' });
    created.orgs.push(orgId);

    const workItemId = randomUUID();
    await db
      .insert(s.workItems)
      .values({ id: workItemId, org_id: orgId, creator_id: userId, name: 'test item' });
    created.workItems.push(workItemId);

    const artifactId = randomUUID();
    await db.insert(s.artifacts).values({
      id: artifactId,
      work_item_id: workItemId,
      name: 'artifact',
      content_type: CONTENT_TYPE_BY_RENDER_CLASS[renderClass],
      render_class: renderClass,
    });

    const claims: AuthClaims = {
      userId,
      orgId: null,
      role: null,
      email: `${userId}@test.example.com`,
      permissions: [],
      sessionId: randomUUID(),
    };
    return { claims, artifactId };
  }

  it('refuses to open a collaboration document for a page artifact', async () => {
    const { claims, artifactId } = await makeArtifact('page');
    await expect(resolveDocumentAccess(claims, `artifact-${artifactId}`)).rejects.toThrow(
      `Page artifacts have no collaboration document: artifact-${artifactId}`
    );
  });

  // Design §10 decision 1: a pdf/docx/pptx or image is a file, never a Yjs document.
  it('refuses to open a collaboration document for a file artifact', async () => {
    const { claims, artifactId } = await makeArtifact('file');
    await expect(resolveDocumentAccess(claims, `artifact-${artifactId}`)).rejects.toThrow(
      `Only document artifacts have a collaboration document: artifact-${artifactId}`
    );
  });

  it('still resolves the caller role for a document artifact', async () => {
    const { claims, artifactId } = await makeArtifact('document');
    await expect(resolveDocumentAccess(claims, `artifact-${artifactId}`)).resolves.toBe('author');
  });
});
