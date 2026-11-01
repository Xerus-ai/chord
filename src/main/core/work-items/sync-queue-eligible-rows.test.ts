import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A version upload names an artifact the server must already know, so it
 * never drains before that artifact's pending create (design 2026-09-24 §9
 * "Upload"). Ascending-id order is not enough: a create re-enqueued by the
 * startup reconcile gets a higher id than an upload queued before it.
 * Real SQLite from the shipped migrations.
 */
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const { db } = await import('@main/db/client');
const { syncQueue } = await import('@main/db/schema-sync');
const { selectEligibleSyncRows } = await import('./sync-queue-eligible-rows');

function queueArtifactCreate(artifactId: string, workItemId = 'w-upload'): number {
  const [row] = db
    .insert(syncQueue)
    .values({
      entityType: 'artifact',
      operation: 'create',
      entityId: artifactId,
      payload: JSON.stringify({
        work_item_id: workItemId,
        name: `${artifactId}.html`,
        content_type: 'web',
        render_class: 'page',
      }),
    })
    .returning({ id: syncQueue.id })
    .all();
  return row!.id;
}

function queueUpload(versionId: string, artifactId: string, workItemId = 'w-upload'): number {
  const [row] = db
    .insert(syncQueue)
    .values({
      entityType: 'artifact_version_upload',
      operation: 'create',
      entityId: versionId,
      payload: JSON.stringify({
        artifact_id: artifactId,
        work_item_id: workItemId,
        client_version_id: versionId,
        trigger: 'agent_milestone',
        label: null,
        content: '<p>v1</p>',
        view_html: '<html></html>',
      }),
    })
    .returning({ id: syncQueue.id })
    .all();
  return row!.id;
}

function queueWorkItemCreate(workItemId: string): number {
  const [row] = db
    .insert(syncQueue)
    .values({
      entityType: 'work_item',
      operation: 'create',
      entityId: workItemId,
      payload: JSON.stringify({ name: 'Pending', status: 'active' }),
    })
    .returning({ id: syncQueue.id })
    .all();
  return row!.id;
}

function eligibleIds(orgId: string | null = 'org-1'): number[] {
  return selectEligibleSyncRows(orgId, 50).map((row) => row.id);
}

beforeEach(() => {
  db.delete(syncQueue).run();
});

describe('selectEligibleSyncRows — artifact version uploads', () => {
  it('holds an upload back while its artifact’s create is pending, even when queued first', () => {
    const upload = queueUpload('v-1', 'a-1');
    const create = queueArtifactCreate('a-1');
    expect(eligibleIds()).toEqual([create]);
    expect(eligibleIds()).not.toContain(upload);
  });

  it('releases the upload once the create has drained', () => {
    const create = queueArtifactCreate('a-1');
    const upload = queueUpload('v-1', 'a-1');
    expect(eligibleIds()).toEqual([create]);

    db.delete(syncQueue).where(eq(syncQueue.id, create)).run();
    expect(eligibleIds()).toEqual([upload]);
  });

  it('does not hold an upload behind another artifact’s create', () => {
    const otherCreate = queueArtifactCreate('a-other');
    const upload = queueUpload('v-1', 'a-1');
    expect(eligibleIds()).toEqual([otherCreate, upload]);
  });

  it('holds an upload back while its work item’s create waits for an org', () => {
    queueWorkItemCreate('w-upload');
    queueUpload('v-1', 'a-1');
    expect(eligibleIds(null)).toEqual([]);
  });
});

/**
 * A child row names a work item the server must already have. Sent before
 * its parent's create settles, it only earns a 404 — and a child whose orphan
 * clock started on an earlier launch is failed out by that one 404, a false
 * "N failed" that clears once the parent settles (devstation-as2).
 */
describe('selectEligibleSyncRows — children of a work item whose create is queued', () => {
  function queueChatBulk(workItemId: string): number {
    const [row] = db
      .insert(syncQueue)
      .values({
        entityType: 'chat_message_bulk',
        operation: 'update',
        entityId: workItemId,
        payload: JSON.stringify({ messages: [] }),
      })
      .returning({ id: syncQueue.id })
      .all();
    return row!.id;
  }

  it('holds them back while the create is pending, with an org, even when queued first', () => {
    const chat = queueChatBulk('w-parent');
    const artifact = queueArtifactCreate('a-1', 'w-parent');
    const create = queueWorkItemCreate('w-parent');

    expect(eligibleIds()).toEqual([create]);
    expect(eligibleIds()).not.toContain(chat);
    expect(eligibleIds()).not.toContain(artifact);
  });

  it('releases them once the create has drained', () => {
    const chat = queueChatBulk('w-parent');
    const artifact = queueArtifactCreate('a-1', 'w-parent');
    const create = queueWorkItemCreate('w-parent');

    db.delete(syncQueue).where(eq(syncQueue.id, create)).run();
    expect(eligibleIds()).toEqual([chat, artifact]);
  });

  it('does not hold them behind another work item’s create', () => {
    const chat = queueChatBulk('w-parent');
    const otherCreate = queueWorkItemCreate('w-other');
    expect(eligibleIds()).toEqual([chat, otherCreate]);
  });
});
