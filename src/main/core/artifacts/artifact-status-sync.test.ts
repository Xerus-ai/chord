import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * An artifact's status (Draft, In review, Approved, Built) reaches the cloud,
 * so a teammate's file bar shows what the owner's does (devstation-664). The
 * register request carries it, and a status change re-registers the artifact
 * (the register is an idempotent upsert server-side). Real SQLite and a real
 * local HTTP server; the signed-in account goes through the real account path.
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
const { workItems } = await import('@main/db/schema-work-items');
const { artifacts } = await import('@main/db/schema-artifacts');
const { signInTestAccount } = await import('@main/core/account/_testing/test-account');
const { createCloudArtifact } = await import('./cloud-artifacts-client');
const { artifactsController } = await import('./controller');

const WORK_ITEM_ID = 'w-status';
const ARTIFACT_ID = 'a-status';

let server: Server;
let captured: Array<{ url: string | undefined; body: Record<string, unknown> }>;
const originalApiUrl = process.env.CHORD_CLOUD_API_URL;

function artifactQueueRows() {
  return db
    .select()
    .from(syncQueue)
    .where(eq(syncQueue.entityType, 'artifact'))
    .all()
    .map((row) => ({
      operation: row.operation,
      entityId: row.entityId,
      body: JSON.parse(row.payload) as Record<string, unknown>,
    }));
}

beforeAll(async () => {
  await signInTestAccount({ username: 'ada', email: 'ada@example.com' });
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      captured.push({
        url: req.url,
        body: JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Record<string, unknown>,
      });
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  process.env.CHORD_CLOUD_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await db.insert(workItems).values({ id: WORK_ITEM_ID, name: 'Status', repoPath: '/repo/status' });
  await db.insert(artifacts).values({
    id: ARTIFACT_ID,
    workItemId: WORK_ITEM_ID,
    filePath: 'plan.md',
    name: 'plan.md',
    type: 'markdown',
    contentType: 'markdown',
    status: 'draft',
  });
});

afterAll(async () => {
  if (originalApiUrl === undefined) delete process.env.CHORD_CLOUD_API_URL;
  else process.env.CHORD_CLOUD_API_URL = originalApiUrl;
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  captured = [];
  db.delete(syncQueue).run();
});

describe('createCloudArtifact', () => {
  it('registers the artifact with its status', async () => {
    const result = await createCloudArtifact(ARTIFACT_ID, {
      work_item_id: WORK_ITEM_ID,
      name: 'plan.md',
      content_type: 'markdown',
      render_class: 'document',
      status: 'in_review',
    });

    expect(result).toEqual({ ok: true });
    expect(captured).toEqual([
      {
        url: `/work-items/${WORK_ITEM_ID}/artifacts`,
        body: {
          id: ARTIFACT_ID,
          name: 'plan.md',
          content_type: 'markdown',
          render_class: 'document',
          status: 'in_review',
        },
      },
    ]);
  });
});

describe('artifacts.updateStatus', () => {
  it('queues a re-register carrying the new status', async () => {
    const result = await artifactsController.updateStatus({ id: ARTIFACT_ID, status: 'approved' });
    expect(result.success).toBe(true);

    expect(artifactQueueRows()).toEqual([
      {
        operation: 'create',
        entityId: ARTIFACT_ID,
        body: {
          work_item_id: WORK_ITEM_ID,
          name: 'plan.md',
          content_type: 'markdown',
          render_class: 'document',
          status: 'approved',
        },
      },
    ]);
  });

  it('a second change before the first is sent leaves one register, with the latest status', async () => {
    await artifactsController.updateStatus({ id: ARTIFACT_ID, status: 'in_review' });
    await artifactsController.updateStatus({ id: ARTIFACT_ID, status: 'built' });

    const rows = artifactQueueRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].body.status).toBe('built');
  });
});
