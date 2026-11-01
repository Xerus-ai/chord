import { randomUUID } from 'node:crypto';
import type { ServerEvent } from '@chord/protocol';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { startHocuspocusServer as StartHocuspocusServerFn } from '../hocuspocus.js';
import { createSharingFixture } from './sharing/__tests__/sharing-fixture.js';

/**
 * The last batch of an agent's edits (`final: true`) is a milestone
 * (the P6 sharing design §9 decision 4): once the edits
 * have flushed through the real Hocuspocus server, the document is saved as an
 * `agent_milestone` version and announced. Earlier batches save nothing.
 *
 * The Yjs socket authenticates with a WorkOS JWT that a test cannot mint, so
 * this file runs with DEV_MODE (auth.ts verifyAccessToken's documented local
 * bypass). The agent-edits route itself still resolves the caller's artifact
 * access through the real resolver against the real database.
 */
describe('POST /agent-edits final → agent milestone (real DB, real Hocuspocus)', () => {
  const f = createSharingFixture();
  vi.stubEnv('DEV_MODE', 'true');

  let hocuspocus: Awaited<ReturnType<typeof StartHocuspocusServerFn>>;

  beforeAll(async () => {
    await f.start();
    const { startHocuspocusServer } = await import('../hocuspocus.js');
    hocuspocus = await startHocuspocusServer(0);
    vi.stubEnv('HOCUSPOCUS_PORT', String(hocuspocus.address.port));
  });

  afterAll(async () => {
    await hocuspocus.destroy();
    await f.stop();
  });

  async function setup() {
    const author = await f.makeUser();
    const orgId = await f.makeTeam(author.id, []);
    const workItemId = randomUUID();
    await f.db
      .insert(f.s.workItems)
      .values({ id: workItemId, org_id: orgId, creator_id: author.id, name: 'item' });
    const artifactId = randomUUID();
    await f.db.insert(f.s.artifacts).values({
      id: artifactId,
      work_item_id: workItemId,
      name: 'plan.md',
      content_type: 'markdown',
      render_class: 'document',
    });
    const doc = new Y.Doc();
    const intro = new Y.XmlElement('paragraph');
    intro.insert(0, [new Y.XmlText('Intro')]);
    doc.getXmlFragment('default').insert(0, [intro]);
    await f.db.insert(f.s.yjsDocuments).values({
      document_name: `artifact-${artifactId}`,
      state: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64'),
    });
    return { author, workItemId, artifactId };
  }

  async function versionRows(artifactId: string) {
    const { eq } = await import('drizzle-orm');
    return f.db
      .select()
      .from(f.s.artifactVersions)
      .where(eq(f.s.artifactVersions.artifact_id, artifactId))
      .orderBy(f.s.artifactVersions.version_number);
  }

  function paragraphsOf(snapshotBase64: string): string[] {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(Buffer.from(snapshotBase64, 'base64')));
    const texts = doc
      .getXmlFragment('default')
      .toArray()
      .map((node) => (node instanceof Y.XmlElement ? node.toArray().join('') : ''));
    doc.destroy();
    return texts;
  }

  function versionEvents(room: ServerEvent[]): ServerEvent[] {
    return room.filter((e) => e.type === 'artifact_version_created');
  }

  it('saves the edited document as an agent_milestone version after the final batch', async () => {
    const { author, workItemId, artifactId } = await setup();
    const workItemRoom = f.watchRoom(`work_item:${workItemId}`);
    const artifactRoom = f.watchRoom(`artifact:${artifactId}`);

    const first = await f.as(author.id).post('/agent-edits', {
      artifact_id: artifactId,
      operations: [{ type: 'insert_xml', tag: 'paragraph', value: 'Agent step one' }],
    });
    expect(first.status).toBe(200);
    expect(await versionRows(artifactId)).toEqual([]);

    const last = await f.as(author.id).post('/agent-edits', {
      artifact_id: artifactId,
      operations: [{ type: 'insert_xml', tag: 'paragraph', value: 'Agent step two' }],
      final: true,
    });
    expect(last.status).toBe(200);

    const versions = await versionRows(artifactId);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      version_number: 1,
      trigger: 'agent_milestone',
      author_id: author.id,
      content: null,
    });

    const { eq } = await import('drizzle-orm');
    const [snapshot] = await f.db
      .select({ snapshot: f.s.artifactVersionSnapshots.snapshot })
      .from(f.s.artifactVersionSnapshots)
      .where(eq(f.s.artifactVersionSnapshots.version_id, versions[0]!.id));
    expect(paragraphsOf(snapshot!.snapshot)).toEqual(['Intro', 'Agent step one', 'Agent step two']);

    for (const room of [workItemRoom, artifactRoom]) {
      const events = versionEvents(room);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        payload: {
          work_item_id: workItemId,
          artifact_id: artifactId,
          version_id: versions[0]!.id,
          version_number: 1,
          trigger: 'agent_milestone',
          has_view: false,
        },
      });
    }
  }, 60_000);

  it('saves nothing for a batch that is not final', async () => {
    const { author, workItemId, artifactId } = await setup();
    const workItemRoom = f.watchRoom(`work_item:${workItemId}`);

    const res = await f.as(author.id).post('/agent-edits', {
      artifact_id: artifactId,
      operations: [{ type: 'insert_xml', tag: 'paragraph', value: 'Still working' }],
    });
    expect(res.status).toBe(200);
    expect(await versionRows(artifactId)).toEqual([]);
    expect(versionEvents(workItemRoom)).toEqual([]);
  }, 60_000);
});
