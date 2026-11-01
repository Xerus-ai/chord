import { randomUUID } from 'node:crypto';
import type { NotificationView, ServerEvent } from '@chord/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSharingFixture } from '../../routes/sharing/__tests__/sharing-fixture.js';
import type { AuthenticatedWebSocket } from '../../ws/connection-manager.js';
import type * as EventHandlersNS from '../../ws/event-handlers.js';
import type * as RetentionNS from '../delete-expired-notifications.js';
import type * as TeamInviteNS from '../notify-team-invite.js';

/**
 * Shared-items step 2 (N2), the producers outside sharing and what happens to
 * a row over time: a chat message and a team invite are stored as facts, a
 * deleted work item leaves the row with no name to show, and read rows older
 * than 30 days are deleted.
 *
 * Runs the production routes on a real (PGlite) database: sharing fixture.
 * The team invite is notified by notifyTeamInvite, called here on a real
 * invite row: the invite route sends its email through WorkOS first
 * (lib/team-invites.ts), which a test cannot reach without faking it.
 */
describe('notification lifecycle (real DB)', () => {
  const f = createSharingFixture();
  let handleChatMessage: typeof EventHandlersNS.handleChatMessage;
  let deleteExpiredNotifications: typeof RetentionNS.deleteExpiredNotifications;
  let notifyTeamInvite: typeof TeamInviteNS.notifyTeamInvite;

  beforeAll(async () => {
    await f.start();
    ({ handleChatMessage } = await import('../../ws/event-handlers.js'));
    ({ deleteExpiredNotifications } = await import('../delete-expired-notifications.js'));
    ({ notifyTeamInvite } = await import('../notify-team-invite.js'));
  });
  afterAll(() => f.stop());

  async function sharedWorkItem() {
    const author = await f.makeUser();
    const teammate = await f.makeUser();
    const orgId = await f.makeTeam(author.id, [teammate.id]);
    const created = await f.as(author.id).post('/work-items', {
      id: randomUUID(),
      name: 'Landing page copy',
      org_id: orgId,
    });
    const workItemId = created.body.id as string;
    const shared = await f
      .as(author.id)
      .post(`/work-items/${workItemId}/members`, { email: teammate.email, role: 'edit' });
    expect(shared.status).toBe(201);
    return { author, teammate, orgId, workItemId };
  }

  async function inbox(userId: string, type: string): Promise<NotificationView[]> {
    const res = await f.as(userId).get('/notifications');
    expect(res.status).toBe(200);
    return (res.body as NotificationView[]).filter((row) => row.type === type);
  }

  /** The sender's socket: handleChatMessage acks on it and joins it to the room. */
  function senderSocket(userId: string, email: string): AuthenticatedWebSocket {
    return {
      user: { userId, orgId: null, role: null, email, permissions: [], sessionId: userId },
      isAlive: true,
      rooms: new Set<string>(),
      lastSeen: new Date(),
      clientType: 'renderer',
      deviceId: null,
      readyState: 1,
      OPEN: 1,
      bufferedAmount: 0,
      send: () => {},
      on: () => {},
      terminate: () => {},
    } as unknown as AuthenticatedWebSocket;
  }

  it('stores a chat message for an offline teammate as new_message facts', async () => {
    const { author, teammate, workItemId } = await sharedWorkItem();
    const messageId = randomUUID();
    const content = 'y'.repeat(230);

    await handleChatMessage(
      senderSocket(author.id, author.email),
      {
        type: 'chat_message',
        payload: { id: messageId, work_item_id: workItemId, content, message_type: 'text' },
      },
      f.connectionManager
    );

    expect(await inbox(teammate.id, 'new_message')).toEqual([
      expect.objectContaining({
        actor_user_id: author.id,
        actor_name: author.id.slice(0, 4),
        work_item_id: workItemId,
        work_item_name: 'Landing page copy',
        message_id: messageId,
        excerpt: 'y'.repeat(200),
      }),
    ]);
    expect(await inbox(author.id, 'new_message')).toEqual([]);
  });

  it('stores a team invite as the inviter and the team, with the invite id live', async () => {
    const owner = await f.makeUser();
    const invitee = await f.makeUser();
    const orgId = await f.makeTeam(owner.id, []);
    const live: ServerEvent[] = f.watchUser(invitee.id);
    const inviteId = randomUUID();
    await f.db.insert(f.s.teamInvites).values({
      id: inviteId,
      org_id: orgId,
      inviter_id: owner.id,
      email: invitee.email,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    await notifyTeamInvite(f.connectionManager, {
      inviteId,
      orgId,
      inviterId: owner.id,
      inviteeId: invitee.id,
    });

    const [row] = await inbox(invitee.id, 'team_invite');
    expect(row).toMatchObject({
      actor_user_id: owner.id,
      actor_name: owner.id.slice(0, 4),
      org_id: orgId,
      org_name: 'team',
      work_item_id: null,
    });
    const frame = live.find((event) => event.type === 'notification_received');
    expect(frame?.payload).toEqual({ ...row, invite_id: inviteId });
  });

  it('keeps a row whose work item was deleted, with no work item to name', async () => {
    const { author, teammate, workItemId } = await sharedWorkItem();

    const deleted = await f.as(author.id).del(`/work-items/${workItemId}`);
    expect(deleted.status).toBeLessThan(300);

    expect(await inbox(teammate.id, 'shared_with_you')).toEqual([
      expect.objectContaining({
        actor_user_id: author.id,
        work_item_id: null,
        work_item_name: null,
      }),
    ]);
  });

  it('deletes read rows older than 30 days, and nothing else', async () => {
    const user = await f.makeUser();
    const now = new Date('2026-09-27T12:00:00.000Z');
    const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const row = (id: string, read: boolean, createdAt: Date) => ({
      id,
      user_id: user.id,
      type: 'new_message',
      read,
      created_at: createdAt,
    });
    await f.db
      .insert(f.s.notifications)
      .values([
        row(`old-read-${user.id}`, true, daysAgo(31)),
        row(`old-unread-${user.id}`, false, daysAgo(31)),
        row(`recent-read-${user.id}`, true, daysAgo(29)),
      ]);

    await deleteExpiredNotifications(now);

    const { eq } = await import('drizzle-orm');
    const left = await f.db
      .select({ id: f.s.notifications.id })
      .from(f.s.notifications)
      .where(eq(f.s.notifications.user_id, user.id));
    expect(left.map((r) => r.id).sort()).toEqual([
      `old-unread-${user.id}`,
      `recent-read-${user.id}`,
    ]);
  });
});
