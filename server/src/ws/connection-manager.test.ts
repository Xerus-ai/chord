import type { ServerEvent } from '@chord/protocol';
import { describe, expect, it } from 'vitest';
import type { AuthClaims } from '../middleware/auth.js';
import { ConnectionManager, type AuthenticatedWebSocket } from './connection-manager.js';

interface FakeSocket {
  ws: AuthenticatedWebSocket;
  sent: ServerEvent[];
}

function claims(userId: string): AuthClaims {
  return {
    userId,
    orgId: 'org_1',
    role: 'member',
    email: `${userId}@example.com`,
    permissions: [],
    sessionId: `session_${userId}`,
  };
}

/**
 * The minimum surface ConnectionManager touches on a socket. Not a mock of
 * behavior — it records what was written so a test can assert on the wire
 * frames, which is the only thing these paths produce.
 */
function fakeSocket(userId: string, clientType: 'renderer' | 'device' = 'renderer'): FakeSocket {
  const sent: ServerEvent[] = [];
  const ws = {
    user: claims(userId),
    isAlive: true,
    rooms: new Set<string>(),
    lastSeen: new Date(),
    clientType,
    deviceId: clientType === 'device' ? `device_${userId}` : null,
    readyState: 1,
    OPEN: 1,
    bufferedAmount: 0,
    send: (raw: string) => sent.push(JSON.parse(raw) as ServerEvent),
    on: () => {},
    terminate: () => {},
  } as unknown as AuthenticatedWebSocket;
  return { ws, sent };
}

const ROOM = 'work_item:item_1';

function framesOfType(socket: FakeSocket, type: string): ServerEvent[] {
  return socket.sent.filter((event) => event.type === type);
}

describe('ConnectionManager room envelope', () => {
  it('stamps room_seq/epoch on events carrying a top-level work_item_id', () => {
    const manager = new ConnectionManager();
    const sender = fakeSocket('user_a');
    const peer = fakeSocket('user_b');
    manager.joinRoom(sender.ws, ROOM);
    manager.joinRoom(peer.ws, ROOM);

    manager.broadcastToRoom(ROOM, {
      type: 'work_item_deleted',
      payload: { work_item_id: 'item_1' },
    });

    const [frame] = framesOfType(peer, 'work_item_deleted');
    expect(frame?.room_seq).toBe(1);
    expect(typeof frame?.epoch).toBe('string');
  });

  it('leaves member churn out of the sequence so the gap detector cannot over-fire', () => {
    const manager = new ConnectionManager();
    const peer = fakeSocket('user_b');
    manager.joinRoom(peer.ws, ROOM);

    manager.broadcastToRoom(ROOM, {
      type: 'work_item_deleted',
      payload: { work_item_id: 'item_1' },
    });
    // member_joined/member_left carry no work_item_id: a client cannot key a
    // per-room cursor off them, so they must not consume a sequence number.
    manager.broadcastToRoom(ROOM, {
      type: 'member_joined',
      payload: { roomId: ROOM, user: { userId: 'user_c', email: 'c@example.com', role: null } },
    });
    manager.broadcastToRoom(ROOM, {
      type: 'work_item_deleted',
      payload: { work_item_id: 'item_1' },
    });

    const memberFrame = framesOfType(peer, 'member_joined')[0];
    expect(memberFrame?.room_seq).toBeUndefined();
    expect(memberFrame?.epoch).toBeUndefined();

    const tracked = framesOfType(peer, 'work_item_deleted').map((event) => event.room_seq);
    expect(tracked).toEqual([1, 2]);
  });
});

describe('ConnectionManager member_left', () => {
  it('stays silent while another window of the same user is still in the room', () => {
    const manager = new ConnectionManager();
    const windowOne = fakeSocket('user_a');
    const windowTwo = fakeSocket('user_a');
    const peer = fakeSocket('user_b');
    manager.joinRoom(windowOne.ws, ROOM);
    manager.joinRoom(windowTwo.ws, ROOM);
    manager.joinRoom(peer.ws, ROOM);

    manager.leaveRoom(windowOne.ws, ROOM);
    manager.announceMemberLeft('user_a', ROOM);

    expect(framesOfType(peer, 'member_left')).toHaveLength(0);
  });

  it('announces once the user has no renderer socket left in the room', () => {
    const manager = new ConnectionManager();
    const windowOne = fakeSocket('user_a');
    const windowTwo = fakeSocket('user_a');
    const peer = fakeSocket('user_b');
    manager.joinRoom(windowOne.ws, ROOM);
    manager.joinRoom(windowTwo.ws, ROOM);
    manager.joinRoom(peer.ws, ROOM);

    manager.leaveRoom(windowOne.ws, ROOM);
    manager.announceMemberLeft('user_a', ROOM);
    manager.leaveRoom(windowTwo.ws, ROOM);
    manager.announceMemberLeft('user_a', ROOM);

    const frames = framesOfType(peer, 'member_left');
    expect(frames).toHaveLength(1);
    expect(frames[0]?.payload).toEqual({ roomId: ROOM, userId: 'user_a' });
  });

  it('does not count a device socket as the user still being present', () => {
    const manager = new ConnectionManager();
    const renderer = fakeSocket('user_a');
    const device = fakeSocket('user_a', 'device');
    const peer = fakeSocket('user_b');
    manager.joinRoom(renderer.ws, ROOM);
    manager.joinRoom(device.ws, ROOM);
    manager.joinRoom(peer.ws, ROOM);

    manager.leaveRoom(renderer.ws, ROOM);
    manager.announceMemberLeft('user_a', ROOM);

    expect(framesOfType(peer, 'member_left')).toHaveLength(1);
  });
});

describe('ConnectionManager access revocation evicts device sockets', () => {
  it('kicks a revoked user whose only room socket is their DEVICE (main-process) channel', () => {
    const manager = new ConnectionManager();
    const creator = fakeSocket('user_creator');
    // The de-scoped user is present ONLY via their device (command-channel)
    // socket — the exact case getRoomMembers hides and connections never tracks.
    const revokedDevice = fakeSocket('user_revoked', 'device');
    manager.joinRoom(creator.ws, ROOM);
    manager.joinRoom(revokedDevice.ws, ROOM);

    // A device-only occupant must still be a candidate for the sweep.
    expect(manager.getRoomUserIds(ROOM).sort()).toEqual(['user_creator', 'user_revoked']);

    // Mirror the /sharing-level eviction: retain the creator, evict everyone
    // else the room still holds a socket for.
    const retained = new Set<string>(['user_creator']);
    for (const userId of manager.getRoomUserIds(ROOM)) {
      if (!retained.has(userId)) {
        manager.removeUserFromRoom(userId, ROOM);
      }
    }

    // (a) The device socket is gone from both the room set and its own rooms.
    expect(manager.getRoomUserIds(ROOM)).toEqual(['user_creator']);
    expect(revokedDevice.ws.rooms.has(ROOM)).toBe(false);
    // It was told it was kicked.
    expect(framesOfType(revokedDevice, 'removed_from_room')).toHaveLength(1);

    // (b) A subsequent broadcast never reaches the evicted device.
    manager.broadcastToRoom(ROOM, {
      type: 'work_item_deleted',
      payload: { work_item_id: 'item_1' },
    });
    expect(framesOfType(revokedDevice, 'work_item_deleted')).toHaveLength(0);
    expect(framesOfType(creator, 'work_item_deleted')).toHaveLength(1);
  });
});
