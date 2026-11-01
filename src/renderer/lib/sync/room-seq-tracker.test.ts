import { describe, expect, it } from 'vitest';
import { createRoomSeqTracker } from './room-seq-tracker';

const ROOM = 'work_item:item_1';
const EPOCH = 'epoch_1';

describe('createRoomSeqTracker', () => {
  it('reports no gap for a contiguous sequence', () => {
    const tracker = createRoomSeqTracker();
    expect(tracker.track(ROOM, EPOCH, 1)).toBe(false);
    expect(tracker.track(ROOM, EPOCH, 2)).toBe(false);
    expect(tracker.track(ROOM, EPOCH, 3)).toBe(false);
  });

  it('reports a gap when a sequence number is skipped', () => {
    const tracker = createRoomSeqTracker();
    tracker.track(ROOM, EPOCH, 1);
    expect(tracker.track(ROOM, EPOCH, 4)).toBe(true);
  });

  it('keeps rooms independent', () => {
    const tracker = createRoomSeqTracker();
    tracker.track(ROOM, EPOCH, 7);
    // A different room's own first frame is not a gap, whatever seq it holds.
    expect(tracker.track('work_item:item_2', EPOCH, 1)).toBe(false);
  });

  it('does not report a gap when the server restarted (new epoch)', () => {
    const tracker = createRoomSeqTracker();
    tracker.track(ROOM, EPOCH, 9);
    // Every socket died and reconnected in that case, which already fired the
    // reseed signal from onopen — re-firing mid-stream would be redundant.
    expect(tracker.track(ROOM, 'epoch_2', 1)).toBe(false);
  });

  it('ignores a stale re-delivery without rewinding the cursor', () => {
    const tracker = createRoomSeqTracker();
    tracker.track(ROOM, EPOCH, 1);
    tracker.track(ROOM, EPOCH, 2);
    expect(tracker.track(ROOM, EPOCH, 1)).toBe(false);
    expect(tracker.track(ROOM, EPOCH, 3)).toBe(false);
  });
});
