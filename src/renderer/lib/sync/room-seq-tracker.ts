import { classifySeq, type TimelineCursor } from '@shared/session-stream-reducers';

/**
 * Per-room {epoch, seq} cursor for the sync socket's gap detection — the same
 * shape and semantics as the local turn-stream's TimelineCursor
 * (src/shared/session-stream-reducers.ts), reused through classifySeq rather
 * than reimplemented.
 *
 * Only frames sent through the server's `broadcastToRoom` carry room_seq and
 * epoch, and only those whose payload has a top-level work_item_id carry them
 * at all (server/src/ws/connection-manager.ts stamps the envelope under
 * exactly that rule) — everything else reaches `track` never having consumed
 * a sequence number, so the sequence a client sees stays contiguous.
 *
 * A 'gap' decision means a broadcast to the room may have been missed without
 * the socket disconnecting — a backpressure eviction that reconnected fast, a
 * frame lost between ticks — and the caller's response is to re-fire the
 * reseed signal every REST-seeded consumer already listens for.
 * 'drop_epoch' (the server restarted, resetting every room's counter) is
 * deliberately NOT reported as a gap: an epoch change means every socket
 * already died and reconnected, which fired that signal from onopen.
 *
 * Cursors are deliberately NOT cleared on disconnect: a reconnect's first
 * frame for a room legitimately carrying a higher seq than the stale cursor
 * is exactly the case gap detection exists to catch.
 */
export interface RoomSeqTracker {
  /** Records a room frame; returns true when it revealed a gap. */
  track(roomId: string, epoch: string, roomSeq: number): boolean;
}

export function createRoomSeqTracker(): RoomSeqTracker {
  const cursors = new Map<string, TimelineCursor>();

  return {
    track(roomId, epoch, roomSeq) {
      const cursor = cursors.get(roomId) ?? null;
      const decision = classifySeq(cursor, epoch, roomSeq);
      if (decision !== 'drop_stale') {
        cursors.set(roomId, {
          epoch,
          startSeq: cursor && cursor.epoch === epoch ? cursor.startSeq : roomSeq,
          endSeq: roomSeq,
        });
      }
      return decision === 'gap';
    },
  };
}
