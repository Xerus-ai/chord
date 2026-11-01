import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSharingFixture } from './sharing-fixture.js';

/**
 * "POST /mentions must never grant access" (shared-items design §10): the app
 * asks the owner before sharing with someone they mention, and shares through
 * POST /members. A mention alone reaches nobody outside the work item.
 */
describe('a mention never shares (real DB)', () => {
  const f = createSharingFixture();

  beforeAll(() => f.start());
  afterAll(() => f.stop());

  it('notifies nobody without access, and opens nothing to them', async () => {
    const author = await f.makeUser();
    const outsider = await f.makeUser();
    const orgId = await f.makeTeam(author.id, [outsider.id]);
    const workItemId = (
      await f.as(author.id).post('/work-items', { id: randomUUID(), name: 'item', org_id: orgId })
    ).body.id as string;

    const mentioned = await f.as(author.id).post(`/work-items/${workItemId}/mentions`, {
      user_ids: [outsider.id],
      excerpt: '@outsider have a look',
      message_id: randomUUID(),
    });
    expect(mentioned.status).toBe(200);
    expect(mentioned.body).toEqual({ notified: 0 });

    expect((await f.as(outsider.id).get(`/work-items/${workItemId}`)).status).toBe(404);
    const inbox = (await f.as(outsider.id).get('/notifications')).body as Array<{ type: string }>;
    expect(inbox.filter((n) => n.type === 'mentioned')).toEqual([]);
    const members = await f.db
      .select()
      .from(f.s.resourceMembers)
      .where((await import('drizzle-orm')).eq(f.s.resourceMembers.work_item_id, workItemId));
    expect(members).toEqual([]);
  });
});
