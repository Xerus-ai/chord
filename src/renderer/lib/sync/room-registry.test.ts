import { describe, expect, it } from 'vitest';
import { createRoomRegistry } from './room-registry';

function setup() {
  const sent: string[] = [];
  const registry = createRoomRegistry({
    sendJoin: (roomId) => sent.push(`join ${roomId}`),
    sendLeave: (roomId) => sent.push(`leave ${roomId}`),
  });
  return { registry, sent };
}

const ROOM = 'work_item:w1';

/**
 * The rooms a window holds (sync-socket-provider): ref-counted across
 * consumers, with the server's answer to each join. A refused room is not
 * retried on its own, but access can be granted later (a share), and then it
 * must be joined again even though a consumer never let go of it.
 */
describe('room registry', () => {
  it('joins on the first consumer, leaves after the last', () => {
    const { registry, sent } = setup();
    const releaseA = registry.acquire(ROOM, () => {});
    const releaseB = registry.acquire(ROOM, () => {});
    expect(sent).toEqual([`join ${ROOM}`]);
    expect(registry.status(ROOM)).toBe('joining');

    releaseA();
    expect(sent).toEqual([`join ${ROOM}`]);
    releaseB();
    expect(sent).toEqual([`join ${ROOM}`, `leave ${ROOM}`]);
    expect(registry.status(ROOM)).toBeNull();
  });

  it("records the server's answer and tells every holder", () => {
    const { registry } = setup();
    let notified = 0;
    registry.acquire(ROOM, () => notified++);
    registry.applyLifecycle(ROOM, 'room_join_denied');
    expect(registry.status(ROOM)).toBe('denied');
    expect(notified).toBe(1);
  });

  it('does not retry a refused room for a second consumer', () => {
    const { registry, sent } = setup();
    registry.acquire(ROOM, () => {});
    registry.applyLifecycle(ROOM, 'room_join_denied');
    registry.acquire(ROOM, () => {});
    expect(sent).toEqual([`join ${ROOM}`]);
    expect(registry.status(ROOM)).toBe('denied');
  });

  it('never sends a leave for a room it was refused', () => {
    const { registry, sent } = setup();
    const release = registry.acquire(ROOM, () => {});
    registry.applyLifecycle(ROOM, 'room_join_denied');
    release();
    expect(sent).toEqual([`join ${ROOM}`]);
  });

  it('joins a refused room again once access may have been granted', () => {
    const { registry, sent } = setup();
    let notified = 0;
    registry.acquire(ROOM, () => notified++);
    registry.applyLifecycle(ROOM, 'room_join_denied');

    expect(registry.retryRefused(ROOM)).toBe(true);
    expect(sent).toEqual([`join ${ROOM}`, `join ${ROOM}`]);
    expect(registry.status(ROOM)).toBe('joining');
    expect(notified).toBe(2);

    registry.applyLifecycle(ROOM, 'room_joined');
    expect(registry.status(ROOM)).toBe('joined');
  });

  it('joins a room it was removed from again once access may have been granted', () => {
    const { registry, sent } = setup();
    registry.acquire(ROOM, () => {});
    registry.applyLifecycle(ROOM, 'room_joined');
    registry.applyLifecycle(ROOM, 'removed_from_room');
    expect(registry.status(ROOM)).toBe('removed');

    expect(registry.retryRefused(ROOM)).toBe(true);
    expect(sent).toEqual([`join ${ROOM}`, `join ${ROOM}`]);
  });

  it('leaves a joined room, and a room nobody holds, alone on a retry', () => {
    const { registry, sent } = setup();
    registry.acquire(ROOM, () => {});
    registry.applyLifecycle(ROOM, 'room_joined');
    expect(registry.retryRefused(ROOM)).toBe(false);
    expect(registry.retryRefused('work_item:nobody')).toBe(false);
    expect(sent).toEqual([`join ${ROOM}`]);
  });

  it('on reconnect, replays every held room but the refused ones', () => {
    const { registry } = setup();
    registry.acquire('work_item:a', () => {});
    registry.acquire('work_item:b', () => {});
    registry.acquire('work_item:c', () => {});
    registry.applyLifecycle('work_item:a', 'room_joined');
    registry.applyLifecycle('work_item:b', 'room_join_denied');

    registry.markDisconnected();
    expect(registry.status('work_item:a')).toBe('joining');
    expect(registry.takeReplay()).toEqual(['work_item:a', 'work_item:c']);
    expect(registry.status('work_item:b')).toBe('denied');
  });
});
