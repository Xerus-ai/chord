import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { eq as EqFn, inArray as InArrayFn } from 'drizzle-orm';
import express, { type Express } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { Database } from '../db/client.js';
import type { ServerSchema } from '../db/server-schema.js';
import { createTestDatabase } from '../db/test-database.js';
import type { AuthClaims } from '../middleware/auth.js';

/**
 * Real-DB route tests for artifact render classes (artifact publishing plan,
 * P1a step 8): a page artifact is registered as `render_class = 'page'`, has
 * no Yjs room, and versions its source text instead of a Yjs snapshot. Same
 * database setup and dynamic-import convention as work-item-sessions.test.ts:
 * client.ts and access-control.ts read env at import time.
 */
describe('artifact render class routes (real DB)', () => {
  const testDb = createTestDatabase();
  vi.stubEnv('DATABASE_URL', testDb.url);
  vi.stubEnv('WORKOS_CLIENT_ID', 'client_test');
  vi.stubEnv('DEV_MODE', ''); // force real access checks, not the owner bypass
  // Nothing listens here: an agent edit that reached the Yjs client would fail
  // to sync rather than silently succeed.
  vi.stubEnv('HOCUSPOCUS_PORT', '1');

  let db: Database;
  let s: ServerSchema;
  let inArray: typeof InArrayFn;
  let eq: typeof EqFn;

  let server: ReturnType<Express['listen']>;
  let base: string;

  let currentUserId: string | null = null;
  const created = {
    users: [] as string[],
    orgs: [] as string[],
    workItems: [] as string[],
    documents: [] as string[],
  };

  beforeAll(async () => {
    await testDb.start();
    const client = await import('../db/client.js');
    db = client.db;
    ({ serverSchema: s } = await import('../db/server-schema.js'));
    ({ inArray, eq } = await import('drizzle-orm'));
    const { createWorkItemsRouter } = await import('./work-items.js');
    const { createVersionsRouter } = await import('./versions.js');
    const { createAgentEditsRouter } = await import('./agent-edits.js');
    const { ConnectionManager } = await import('../ws/connection-manager.js');

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      if (currentUserId) {
        // The full claim shape auth.ts produces: the versions route stamps
        // `email` as the version author, so a partial user is not a real request.
        (req as unknown as { user: AuthClaims }).user = {
          userId: currentUserId,
          orgId: '',
          role: null,
          email: `${currentUserId}@test.example.com`,
          permissions: [],
          sessionId: 'test-session',
        };
      }
      next();
    });
    const connectionManager = new ConnectionManager();
    app.use('/work-items', createWorkItemsRouter(connectionManager));
    app.use('/work-items/:work_item_id/artifacts', createVersionsRouter(connectionManager));
    app.use('/agent-edits', createAgentEditsRouter(connectionManager));

    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (created.documents.length) {
      await db
        .delete(s.yjsDocuments)
        .where(inArray(s.yjsDocuments.document_name, created.documents));
    }
    if (created.workItems.length) {
      await db.delete(s.workItems).where(inArray(s.workItems.id, created.workItems));
    }
    if (created.orgs.length) {
      await db.delete(s.orgMemberships).where(inArray(s.orgMemberships.org_id, created.orgs));
      await db.delete(s.organizations).where(inArray(s.organizations.id, created.orgs));
    }
    if (created.users.length) {
      await db.delete(s.users).where(inArray(s.users.id, created.users));
    }
    await testDb.stop();
  });

  async function makeOwnedWorkItem(): Promise<string> {
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
    currentUserId = userId;
    return workItemId;
  }

  function post(path: string, body: unknown): Promise<Response> {
    return fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function registerArtifact(
    workItemId: string,
    contentType: string,
    renderClass: 'document' | 'page'
  ): Promise<string> {
    const id = randomUUID();
    const res = await post(`/work-items/${workItemId}/artifacts`, {
      id,
      name: `${contentType}-artifact`,
      content_type: contentType,
      render_class: renderClass,
    });
    expect(res.status).toBe(201);
    return id;
  }

  it('persists the render class an artifact is registered with', async () => {
    const workItemId = await makeOwnedWorkItem();
    const pageId = await registerArtifact(workItemId, 'web', 'page');
    const docId = await registerArtifact(workItemId, 'markdown', 'document');

    const rows = await db
      .select({ id: s.artifacts.id, render_class: s.artifacts.render_class })
      .from(s.artifacts)
      .where(inArray(s.artifacts.id, [pageId, docId]));
    const byId = new Map(rows.map((row) => [row.id, row.render_class]));
    expect(byId.get(pageId)).toBe('page');
    expect(byId.get(docId)).toBe('document');
  });

  it('derives the render class from content_type when a client sends none', async () => {
    const workItemId = await makeOwnedWorkItem();
    const id = randomUUID();
    const res = await post(`/work-items/${workItemId}/artifacts`, {
      id,
      name: 'legacy-client.html',
      content_type: 'web',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { render_class: string };
    expect(body.render_class).toBe('page');
    const [row] = await db
      .select({ render_class: s.artifacts.render_class })
      .from(s.artifacts)
      .where(eq(s.artifacts.id, id));
    expect(row.render_class).toBe('page');
  });

  // Design §9 decision 2: an MDX artifact is a page — viewed through its
  // uploaded view, never a Yjs document.
  it('derives the page render class for mdx and refuses mdx as a document', async () => {
    const workItemId = await makeOwnedWorkItem();
    const derived = await post(`/work-items/${workItemId}/artifacts`, {
      id: randomUUID(),
      name: 'chart.mdx',
      content_type: 'mdx',
    });
    expect(derived.status).toBe(201);
    expect(((await derived.json()) as { render_class: string }).render_class).toBe('page');

    const contradiction = await post(`/work-items/${workItemId}/artifacts`, {
      id: randomUUID(),
      name: 'chart-as-document.mdx',
      content_type: 'mdx',
      render_class: 'document',
    });
    expect(contradiction.status).toBe(400);
  });

  it('refuses a render class that contradicts the content type, and an unknown content type', async () => {
    const workItemId = await makeOwnedWorkItem();
    const contradiction = await post(`/work-items/${workItemId}/artifacts`, {
      id: randomUUID(),
      name: 'page-as-document.html',
      content_type: 'web',
      render_class: 'document',
    });
    expect(contradiction.status).toBe(400);
    expect(((await contradiction.json()) as { error: string }).error).toMatch(/contradicts/);

    const unknown = await post(`/work-items/${workItemId}/artifacts`, {
      id: randomUUID(),
      name: 'mystery.bin',
      content_type: 'mystery',
    });
    expect(unknown.status).toBe(400);
  });

  it('versions a page artifact from its source text, numbered sequentially', async () => {
    const workItemId = await makeOwnedWorkItem();
    const pageId = await registerArtifact(workItemId, 'web', 'page');
    const versionsPath = `/work-items/${workItemId}/artifacts/${pageId}/versions`;

    const first = await post(versionsPath, {
      label: 'first',
      content: '<h1>One</h1>',
      view_html: '<h1>One</h1>',
    });
    expect(first.status).toBe(201);
    const second = await post(versionsPath, { content: '<h1>Twö</h1>', view_html: '<h1>Twö</h1>' });
    expect(second.status).toBe(201);

    const listRes = await fetch(`${base}${versionsPath}`);
    expect(listRes.status).toBe(200);
    const versions = (await listRes.json()) as {
      id: string;
      version_number: number;
      label: string | null;
      byte_size: number;
    }[];
    expect(versions.map((v) => v.version_number)).toEqual([2, 1]);
    expect(versions[1].label).toBe('first');
    // The list stays lean: page source is served by the snapshot endpoint only.
    expect(versions[0]).not.toHaveProperty('content');

    const snapRes = await fetch(`${base}${versionsPath}/${versions[0].id}/snapshot`);
    expect(snapRes.status).toBe(200);
    const snapshot = (await snapRes.json()) as { source: string; byte_size: number };
    expect(snapshot.source).toBe('<h1>Twö</h1>');
    // UTF-8 byte length: the umlaut is two bytes.
    expect(snapshot.byte_size).toBe(Buffer.byteLength('<h1>Twö</h1>', 'utf8'));
    expect(versions[0].byte_size).toBe(snapshot.byte_size);
  });

  it('rejects a page version POST without content', async () => {
    const workItemId = await makeOwnedWorkItem();
    const pageId = await registerArtifact(workItemId, 'prototype', 'page');

    const res = await post(`/work-items/${workItemId}/artifacts/${pageId}/versions`, {
      label: 'no source',
      view_html: '<p>view</p>',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/content/i);

    const rows = await db
      .select({ id: s.artifactVersions.id })
      .from(s.artifactVersions)
      .where(eq(s.artifactVersions.artifact_id, pageId));
    expect(rows).toHaveLength(0);
  });

  it('rejects a document version POST that carries content', async () => {
    const workItemId = await makeOwnedWorkItem();
    const docId = await registerArtifact(workItemId, 'markdown', 'document');

    const res = await post(`/work-items/${workItemId}/artifacts/${docId}/versions`, {
      content: '# not how documents version',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/content/i);
  });

  async function countVersions(artifactId: string): Promise<number> {
    const rows = await db
      .select({ id: s.artifactVersions.id })
      .from(s.artifactVersions)
      .where(eq(s.artifactVersions.artifact_id, artifactId));
    return rows.length;
  }

  // Plan P4 step 3, the same rule the desktop's local store applies
  // (save-artifact-version.ts): a save names the version it was made on.
  it('refuses a page version saved on a stale base_version with 409, storing nothing', async () => {
    const workItemId = await makeOwnedWorkItem();
    const pageId = await registerArtifact(workItemId, 'web', 'page');
    const versionsPath = `/work-items/${workItemId}/artifacts/${pageId}/versions`;

    const save = (content: string, baseVersion: number) =>
      post(versionsPath, { content, view_html: content, base_version: baseVersion });
    expect((await save('<p>1</p>', 0)).status).toBe(201);
    expect((await save('<p>mine</p>', 1)).status).toBe(201);
    const theirs = await save('<p>theirs</p>', 1);
    expect(theirs.status).toBe(409);
    expect(await theirs.json()).toEqual({ error: 'conflict', latest_version: 2 });
    expect(await countVersions(pageId)).toBe(2);
  });

  it('refuses a document version saved on a stale base_version with 409', async () => {
    const workItemId = await makeOwnedWorkItem();
    const docId = await registerArtifact(workItemId, 'markdown', 'document');
    const ydoc = new Y.Doc();
    ydoc.getXmlFragment('default').insert(0, [new Y.XmlText('hello')]);
    created.documents.push(`artifact-${docId}`);
    await db.insert(s.yjsDocuments).values({
      document_name: `artifact-${docId}`,
      state: Buffer.from(Y.encodeStateAsUpdate(ydoc)).toString('base64'),
    });
    const versionsPath = `/work-items/${workItemId}/artifacts/${docId}/versions`;

    expect((await post(versionsPath, { label: 'mine', base_version: 0 })).status).toBe(201);
    const theirs = await post(versionsPath, { label: 'theirs', base_version: 0 });
    expect(theirs.status).toBe(409);
    expect(await theirs.json()).toEqual({ error: 'conflict', latest_version: 1 });
    expect(await countVersions(docId)).toBe(1);
  });

  it('refuses an agent edit on a page artifact with a 4xx, never opening a document', async () => {
    const workItemId = await makeOwnedWorkItem();
    const pageId = await registerArtifact(workItemId, 'web', 'page');

    const res = await post('/agent-edits', {
      artifact_id: pageId,
      operations: [{ type: 'insert_text', index: 0, value: 'x' }],
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/page/i);
  }, 30_000);
});
