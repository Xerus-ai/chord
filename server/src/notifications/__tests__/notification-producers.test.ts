import { randomUUID } from 'node:crypto';
import type { NotificationView, ServerEvent } from '@chord/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSharingFixture } from '../../routes/sharing/__tests__/sharing-fixture.js';

/**
 * Shared-items step 2 (N2): a notification stores facts (who, what, where, an
 * excerpt), never a sentence; the app builds the sentence from the names
 * GET /notifications joins in. Every producer goes through one writer, so the
 * live frame is the same view the listing returns.
 *
 * Runs the production routes on a real (PGlite) database: sharing fixture.
 */
describe('notification producers write facts (real DB)', () => {
  const f = createSharingFixture();

  beforeAll(() => f.start());
  afterAll(() => f.stop());

  async function setup() {
    const author = await f.makeUser();
    const teammate = await f.makeUser();
    const orgId = await f.makeTeam(author.id, [teammate.id]);
    const created = await f.as(author.id).post('/work-items', {
      id: randomUUID(),
      name: 'Landing page copy',
      org_id: orgId,
    });
    const workItemId = created.body.id as string;
    const artifactId = await f.makeArtifact(workItemId);
    return { author, teammate, orgId, workItemId, artifactId };
  }

  async function inbox(userId: string, type?: string): Promise<NotificationView[]> {
    const res = await f.as(userId).get('/notifications');
    expect(res.status).toBe(200);
    const rows = res.body as NotificationView[];
    return type ? rows.filter((row) => row.type === type) : rows;
  }

  function notificationFrames(events: ServerEvent[]): NotificationView[] {
    return events.flatMap((event) =>
      event.type === 'notification_received' ? [event.payload as NotificationView] : []
    );
  }

  async function shareWorkItem(ownerId: string, workItemId: string, email: string) {
    const res = await f
      .as(ownerId)
      .post(`/work-items/${workItemId}/members`, { email, role: 'edit' });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  async function comment(userId: string, workItemId: string, artifactId: string, body: string) {
    const res = await f
      .as(userId)
      .post(`/work-items/${workItemId}/artifacts/${artifactId}/comments`, { body });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  describe('shared_with_you', () => {
    it('names the sharer and the work item, keeps the role, and sends the same view live', async () => {
      const { author, teammate, workItemId } = await setup();
      const live = f.watchUser(teammate.id);

      await shareWorkItem(author.id, workItemId, teammate.email);

      const rows = await inbox(teammate.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        type: 'shared_with_you',
        actor_user_id: author.id,
        actor_name: author.id.slice(0, 4),
        actor_email: author.email,
        work_item_id: workItemId,
        work_item_name: 'Landing page copy',
        artifact_id: null,
        artifact_name: null,
        excerpt: 'edit',
        read: false,
      });
      expect(rows[0]).not.toHaveProperty('title');
      expect(notificationFrames(live)).toEqual(rows);
    });

    it('names the artifact and its work item when one artifact is shared', async () => {
      const { author, teammate, workItemId, artifactId } = await setup();

      const res = await f
        .as(author.id)
        .post(`/work-items/${workItemId}/artifacts/${artifactId}/members`, {
          email: teammate.email,
          role: 'view',
        });
      expect(res.status).toBe(201);

      expect(await inbox(teammate.id)).toEqual([
        expect.objectContaining({
          type: 'shared_with_you',
          actor_user_id: author.id,
          work_item_id: workItemId,
          work_item_name: 'Landing page copy',
          artifact_id: artifactId,
          artifact_name: 'plan.md',
          excerpt: 'view',
        }),
      ]);
    });

    it('writes nothing for a role change or a removal', async () => {
      const { author, teammate, workItemId } = await setup();
      const memberId = await shareWorkItem(author.id, workItemId, teammate.email);

      const changed = await f
        .as(author.id)
        .patch(`/work-items/${workItemId}/members/${memberId}`, { role: 'view' });
      expect(changed.status).toBe(200);
      const removed = await f.as(author.id).del(`/work-items/${workItemId}/members/${memberId}`);
      expect(removed.status).toBe(204);

      expect(await inbox(teammate.id)).toHaveLength(1);
    });
  });

  describe('mentioned', () => {
    it('points a chat mention at its message, with a 200-character excerpt', async () => {
      const { author, teammate, workItemId } = await setup();
      await shareWorkItem(author.id, workItemId, teammate.email);

      const res = await f.as(author.id).post(`/work-items/${workItemId}/mentions`, {
        user_ids: [teammate.id],
        excerpt: 'x'.repeat(250),
        message_id: 'msg-1',
      });
      expect(res.status).toBe(201);

      const [row] = await inbox(teammate.id, 'mentioned');
      expect(row).toMatchObject({
        actor_user_id: author.id,
        work_item_id: workItemId,
        message_id: 'msg-1',
        comment_id: null,
        artifact_id: null,
      });
      expect(row!.excerpt).toBe('x'.repeat(200));
    });

    it('points a comment mention at the comment and its artifact', async () => {
      const { author, teammate, workItemId, artifactId } = await setup();
      await shareWorkItem(author.id, workItemId, teammate.email);
      const commentId = await comment(author.id, workItemId, artifactId, '@mate look');

      const res = await f.as(author.id).post(`/work-items/${workItemId}/mentions`, {
        user_ids: [teammate.id],
        excerpt: '@mate look',
        comment_id: commentId,
      });
      expect(res.status).toBe(201);

      expect(await inbox(teammate.id, 'mentioned')).toEqual([
        expect.objectContaining({
          actor_user_id: author.id,
          artifact_id: artifactId,
          artifact_name: 'plan.md',
          comment_id: commentId,
          message_id: null,
          excerpt: '@mate look',
        }),
      ]);
    });

    it('refuses two sources, and a comment from another work item', async () => {
      const { author, teammate, workItemId, artifactId, orgId } = await setup();
      await shareWorkItem(author.id, workItemId, teammate.email);
      const commentId = await comment(author.id, workItemId, artifactId, 'hi');
      const other = await f
        .as(author.id)
        .post('/work-items', { id: randomUUID(), name: 'other', org_id: orgId });

      const both = await f.as(author.id).post(`/work-items/${workItemId}/mentions`, {
        user_ids: [teammate.id],
        excerpt: 'hi',
        message_id: 'msg-1',
        comment_id: commentId,
      });
      expect(both.status).toBe(400);

      const foreign = await f.as(author.id).post(`/work-items/${other.body.id}/mentions`, {
        user_ids: [teammate.id],
        excerpt: 'hi',
        comment_id: commentId,
      });
      expect(foreign.status).toBe(404);

      expect(await inbox(teammate.id, 'mentioned')).toEqual([]);
    });
  });

  describe('artifact_comment', () => {
    it("tells the work item's author who commented, and not the commenter", async () => {
      const { author, teammate, workItemId, artifactId } = await setup();
      await shareWorkItem(author.id, workItemId, teammate.email);

      const commentId = await comment(teammate.id, workItemId, artifactId, 'CTA contrast is low');

      expect(await inbox(author.id, 'artifact_comment')).toEqual([
        expect.objectContaining({
          actor_user_id: teammate.id,
          actor_name: teammate.id.slice(0, 4),
          work_item_id: workItemId,
          artifact_id: artifactId,
          artifact_name: 'plan.md',
          comment_id: commentId,
          excerpt: 'CTA contrast is low',
        }),
      ]);
      expect(await inbox(teammate.id, 'artifact_comment')).toEqual([]);
    });

    it("writes nothing for the author's own comment", async () => {
      const { author, workItemId, artifactId } = await setup();
      await comment(author.id, workItemId, artifactId, 'note to self');
      expect(await inbox(author.id, 'artifact_comment')).toEqual([]);
    });

    it('names the signed-in person who commented through a public link', async () => {
      const { author, workItemId, artifactId } = await setup();
      const outsider = await f.makeUser();
      const opened = await f
        .as(author.id)
        .patch(`/work-items/${workItemId}/artifacts/${artifactId}/general-access`, {
          general_access: 'link',
          general_role: 'view',
        });
      expect(opened.status).toBe(200);
      const token = String(opened.body.link.url).split('/p/')[1]!;

      const res = await f
        .as(outsider.id)
        .post(`/public-links/${token}/comments`, { body: 'Love it' });
      expect(res.status).toBe(201);

      expect(await inbox(author.id, 'artifact_comment')).toEqual([
        expect.objectContaining({
          actor_user_id: outsider.id,
          actor_name: outsider.id.slice(0, 4),
          artifact_id: artifactId,
          comment_id: res.body.id,
          excerpt: 'Love it',
        }),
      ]);
    });
  });
});
