import { describe, expect, it } from 'vitest';
import { roomGateOf } from './room-gate';

/**
 * The cloud view's room gate (step 4, S8): what a teammate sees from the work
 * item's room status. `revoked` is the contract the view keeps: it tells the
 * work list to clear the requested id, so the dead id is never re-selected.
 */
describe('roomGateOf', () => {
  it('opens the view while the room is joining or joined, and before it answers', () => {
    expect(roomGateOf(null)).toBe('open');
    expect(roomGateOf('joining')).toBe('open');
    expect(roomGateOf('joined')).toBe('open');
  });

  it('shows no access when the room refuses the join', () => {
    expect(roomGateOf('denied')).toBe('denied');
  });

  it('revokes when the owner removes this viewer from the room', () => {
    expect(roomGateOf('removed')).toBe('revoked');
  });
});
