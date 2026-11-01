import { randomUUID } from 'node:crypto';
import type { NotificationView } from '@chord/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type * as ActivateNS from '../../../access/activate-pending-members.js';
import type * as AnnounceNS from '../announce-member-change.js';
import { createSharingFixture } from './sharing-fixture.js';

/**
 * Sharing with someone outside the team leaves a pending member row, keyed by
 * email, until they join the team (access/activate-pending-members.ts). When
 * they do, the share reaches them like any other: the live membership events,
 * and a "shared with you" notification naming the person who shared.
 *
 * The pending rows are written directly: the route that makes them first
 * invites the email to the team through WorkOS (member-routes.ts).
 */
describe('a pending share once its invitee joins the team (real DB)', () => {
  const f = createSharingFixture();
  let activatePendingMembers: typeof ActivateNS.activatePendingMembers;
  let announceActivatedMembers: typeof AnnounceNS.announceActivatedMembers;

  beforeAll(async () => {
    await f.start();
    ({ activatePendingMembers } = await import('../../../access/activate-pending-members.js'));
    ({ announceActivatedMembers } = await import('../announce-member-change.js'));
  });
  afterAll(() => f.stop());

  it('tells the invitee who shared what, once they are in the team', async () => {
    const author = await f.makeUser();
    const invitee = await f.makeUser();
    const orgId = await f.makeTeam(author.id, []);
    const makeItem = async (name: string) =>
      (await f.as(author.id).post('/work-items', { id: randomUUID(), name, org_id: orgId })).body
        .id as string;
    const sharedItem = await makeItem('Landing page copy');
    const otherItem = await makeItem('Pricing');
    const sharedArtifact = await f.makeArtifact(otherItem);
    await f.db.insert(f.s.resourceMembers).values([
      {
        id: randomUUID(),
        work_item_id: sharedItem,
        invited_email: invitee.email,
        role: 'edit',
        granted_by: author.id,
      },
      {
        id: randomUUID(),
        work_item_id: otherItem,
        artifact_id: sharedArtifact,
        invited_email: invitee.email,
        role: 'view',
        granted_by: author.id,
      },
    ]);
    await f.db.insert(f.s.orgMemberships).values({ org_id: orgId, user_id: invitee.id });
    const frames = f.watchUser(invitee.id);

    const activated = await activatePendingMembers(invitee.id, invitee.email);
    expect(activated).toHaveLength(2);
    await announceActivatedMembers(f.connectionManager, invitee.id, invitee.email, activated);

    expect(frames).toContainEqual(
      expect.objectContaining({
        type: 'participant_added',
        payload: expect.objectContaining({ work_item_id: sharedItem, user_id: invitee.id }),
      })
    );
    expect(frames).toContainEqual(
      expect.objectContaining({
        type: 'artifact_access_changed',
        payload: expect.objectContaining({ artifact_id: sharedArtifact, user_id: invitee.id }),
      })
    );

    const live = frames
      .filter((frame) => frame.type === 'notification_received')
      .map((frame) => frame.payload as NotificationView);
    const inbox = (await f.as(invitee.id).get('/notifications')).body as NotificationView[];
    for (const views of [live, inbox]) {
      expect(views).toContainEqual(
        expect.objectContaining({
          type: 'shared_with_you',
          actor_user_id: author.id,
          work_item_id: sharedItem,
          artifact_id: null,
          excerpt: 'edit',
        })
      );
      expect(views).toContainEqual(
        expect.objectContaining({
          type: 'shared_with_you',
          actor_user_id: author.id,
          work_item_id: otherItem,
          artifact_id: sharedArtifact,
          excerpt: 'view',
        })
      );
    }
  });

  it('announces nothing for a pending row it dropped for an existing membership', async () => {
    const author = await f.makeUser();
    const invitee = await f.makeUser();
    const orgId = await f.makeTeam(author.id, [invitee.id]);
    const item = (
      await f.as(author.id).post('/work-items', { id: randomUUID(), name: 'x', org_id: orgId })
    ).body.id as string;
    await f.db.insert(f.s.resourceMembers).values([
      {
        id: randomUUID(),
        work_item_id: item,
        user_id: invitee.id,
        role: 'view',
        granted_by: author.id,
      },
      {
        id: randomUUID(),
        work_item_id: item,
        invited_email: invitee.email,
        role: 'edit',
        granted_by: author.id,
      },
    ]);

    expect(await activatePendingMembers(invitee.id, invitee.email)).toEqual([]);
  });
});
