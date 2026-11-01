import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Comments written on this device before an artifact first reached the cloud
 * (devstation-85y). The comments card writes to the device while the artifact
 * has no cloud id, and reads the cloud once it has one — so the delivery that
 * gives it a cloud id must carry those comments there first, or they vanish
 * from every view:
 *
 * - a delivered artifact create imports the device's comments, then stamps the
 *   artifact synced and drops them from the device, in that order;
 * - a failed import leaves the artifact unsynced with its comments in place,
 *   and the retry sends both again;
 * - comments stranded by builds before this fix (a synced artifact still
 *   holding device comments) are imported by the startup reconcile.
 *
 * Real SQLite from the shipped migrations; the account is signed in through
 * the real account path; the sync server is a local HTTP server answering as
 * routes/work-item-artifacts.ts and routes/comment-import.ts do.
 */
vi.mock('electron', async () => {
  const { electronWithTestKeychain } = await import('@main/core/account/_testing/test-keychain');
  return electronWithTestKeychain();
});
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const { db } = await import('@main/db/client');
const { syncQueue } = await import('@main/db/schema-sync');
const { repos, workItems } = await import('@main/db/schema-work-items');
const { artifactComments, artifacts } = await import('@main/db/schema-artifacts');
const { signInTestAccount } = await import('@main/core/account/_testing/test-account');
const { syncQueueService } = await import('./sync-queue-service');

const WORK_ITEM_ID = '44444444-4444-4444-8444-444444444444';
const ARTIFACT_ID = 'a-probe';
const IMPORT_URL = `/work-items/${WORK_ITEM_ID}/artifacts/${ARTIFACT_ID}/comments/import`;

interface ImportedComment {
  id: string;
  parent_comment_id: string | null;
  anchor_key: string | null;
  anchor_text: string | null;
  body: string;
  resolved: boolean;
  created_at: string;
}

let importAnswer = 200;
let requests: { method: string | undefined; url: string | undefined; body: unknown }[] = [];
let server: Server;
const originalApiUrl = process.env.CHORD_CLOUD_API_URL;

function startSyncServer(): Promise<string> {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      requests.push({ method: req.method, url: req.url, body: raw ? JSON.parse(raw) : null });
      const reply = (status: number, body: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.url === '/auth/sync-profile') return reply(200, { org_id: 'org-import' });
      if (req.url === `/work-items/${WORK_ITEM_ID}/artifacts` && req.method === 'POST') {
        return reply(201, { id: ARTIFACT_ID });
      }
      if (req.url === IMPORT_URL && req.method === 'POST') {
        if (importAnswer !== 200) return reply(importAnswer, { error: 'import failed' });
        const body = JSON.parse(raw) as { comments: ImportedComment[] };
        return reply(200, { imported: body.comments.length });
      }
      return reply(500, { error: `unexpected ${req.method} ${req.url}` });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    });
  });
}

function addDeviceComment(
  id: string,
  fields: Partial<typeof artifactComments.$inferInsert> = {}
): void {
  db.insert(artifactComments)
    .values({ id, artifactId: ARTIFACT_ID, body: `body of ${id}`, authorName: 'me', ...fields })
    .run();
}

function deviceComments() {
  return db
    .select()
    .from(artifactComments)
    .where(eq(artifactComments.artifactId, ARTIFACT_ID))
    .all();
}

function localArtifact() {
  return db.select().from(artifacts).where(eq(artifacts.id, ARTIFACT_ID)).get();
}

function enqueueArtifactCreate(): void {
  syncQueueService.enqueueArtifactCreate(ARTIFACT_ID, {
    work_item_id: WORK_ITEM_ID,
    name: 'probe.html',
    content_type: 'html',
    render_class: 'page',
    status: 'draft',
  });
}

/** Makes every pending row eligible now, past its backoff. */
function skipBackoff(): void {
  db.update(syncQueue).set({ lastAttemptedAt: null }).run();
}

const paths = () =>
  requests.filter((r) => !r.url?.startsWith('/auth/')).map((r) => `${r.method} ${r.url}`);
const importBodies = () =>
  requests
    .filter((r) => r.url === IMPORT_URL)
    .map((r) => (r.body as { comments: ImportedComment[] }).comments);

beforeAll(async () => {
  await signInTestAccount({ username: 'importer', email: 'importer@example.com' });
  process.env.CHORD_CLOUD_API_URL = await startSyncServer();
  await db.insert(repos).values({ id: 'r-import', alias: 'repo', path: '/tmp/import' });
  await db.insert(workItems).values({
    id: WORK_ITEM_ID,
    name: 'Import',
    repoId: 'r-import',
    repoPath: '/tmp/import',
    cloudId: WORK_ITEM_ID,
    syncedAt: 1,
  });
});

beforeEach(async () => {
  requests = [];
  importAnswer = 200;
  db.delete(syncQueue).run();
  db.delete(artifacts).run();
  await db.insert(artifacts).values({
    id: ARTIFACT_ID,
    workItemId: WORK_ITEM_ID,
    filePath: '/tmp/import/probe.html',
    name: 'probe.html',
    type: 'html',
    contentType: 'html',
  });
});

afterEach(() => {
  // enqueue* kicks a timed drain; every test drains explicitly instead.
  syncQueueService.dispose();
});

afterAll(async () => {
  if (originalApiUrl === undefined) delete process.env.CHORD_CLOUD_API_URL;
  else process.env.CHORD_CLOUD_API_URL = originalApiUrl;
  await new Promise((resolve) => server.close(resolve));
});

describe('an artifact create delivered while the device holds its comments', () => {
  it('imports them, then stamps the artifact synced and drops them from the device', async () => {
    addDeviceComment('c-thread', { anchorKey: 'chord-id:h', createdAt: 1790000000 });
    addDeviceComment('c-reply', { parentCommentId: 'c-thread', createdAt: 1790000005 });
    addDeviceComment('c-done', { anchorText: '$24', resolved: 1, createdAt: 1790000010 });
    enqueueArtifactCreate();

    await syncQueueService.processQueue();

    expect(paths()).toEqual([`POST /work-items/${WORK_ITEM_ID}/artifacts`, `POST ${IMPORT_URL}`]);
    const [sent] = importBodies();
    expect(sent).toHaveLength(3);
    expect(new Map(sent.map((c) => [c.id, c]))).toEqual(
      new Map([
        [
          'c-thread',
          {
            id: 'c-thread',
            parent_comment_id: null,
            anchor_key: 'chord-id:h',
            anchor_text: null,
            body: 'body of c-thread',
            resolved: false,
            created_at: new Date(1790000000 * 1000).toISOString(),
          },
        ],
        ['c-reply', expect.objectContaining({ parent_comment_id: 'c-thread', resolved: false })],
        ['c-done', expect.objectContaining({ anchor_text: '$24', resolved: true })],
      ])
    );
    expect(localArtifact()?.cloudId).toBe(ARTIFACT_ID);
    expect(deviceComments()).toEqual([]);
    expect(db.select().from(syncQueue).all()).toEqual([]);
  });

  it('keeps the artifact unsynced with its comments when the import fails, and the retry sends both', async () => {
    addDeviceComment('c-one');
    enqueueArtifactCreate();
    importAnswer = 500;

    await syncQueueService.processQueue();

    expect(localArtifact()?.cloudId).toBeNull();
    expect(deviceComments().map((c) => c.id)).toEqual(['c-one']);
    expect(db.select().from(syncQueue).all()).toMatchObject([
      { entityType: 'artifact', entityId: ARTIFACT_ID, status: 'pending', retryCount: 1 },
    ]);

    importAnswer = 200;
    requests = [];
    skipBackoff();
    await syncQueueService.processQueue();

    expect(paths()).toContain(`POST /work-items/${WORK_ITEM_ID}/artifacts`);
    expect(importBodies().map((batch) => batch.map((c) => c.id))).toEqual([['c-one']]);
    expect(localArtifact()?.cloudId).toBe(ARTIFACT_ID);
    expect(deviceComments()).toEqual([]);
  });

  it('sends no import for an artifact without device comments', async () => {
    enqueueArtifactCreate();

    await syncQueueService.processQueue();

    expect(importBodies()).toEqual([]);
    expect(localArtifact()?.cloudId).toBe(ARTIFACT_ID);
  });
});

describe('a synced artifact still holding device comments (stranded before this fix)', () => {
  it('has them imported by the startup reconcile, then dropped from the device', async () => {
    db.update(artifacts).set({ cloudId: ARTIFACT_ID, syncedAt: 1 }).run();
    addDeviceComment('c-stranded', { createdAt: 1790000000 });

    await syncQueueService.reconcileLocalArtifacts();
    await syncQueueService.processQueue();

    expect(paths()).not.toContain(`POST /work-items/${WORK_ITEM_ID}/artifacts`);
    expect(importBodies().map((batch) => batch.map((c) => c.id))).toEqual([['c-stranded']]);
    expect(deviceComments()).toEqual([]);
    expect(db.select().from(syncQueue).all()).toEqual([]);
  });

  it('keeps them on the device and queued when that import fails', async () => {
    db.update(artifacts).set({ cloudId: ARTIFACT_ID, syncedAt: 1 }).run();
    addDeviceComment('c-stranded');
    importAnswer = 500;

    await syncQueueService.reconcileLocalArtifacts();
    await syncQueueService.processQueue();

    expect(deviceComments().map((c) => c.id)).toEqual(['c-stranded']);
    expect(db.select().from(syncQueue).all()).toMatchObject([
      { entityType: 'artifact_comment_import', entityId: ARTIFACT_ID, status: 'pending' },
    ]);
  });
});
