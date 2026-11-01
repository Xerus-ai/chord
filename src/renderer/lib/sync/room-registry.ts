export type RoomJoinStatus = 'joining' | 'joined' | 'denied' | 'removed';

export type RoomLifecycleFrame = 'room_joined' | 'room_join_denied' | 'removed_from_room';

interface RoomEntry {
  refCount: number;
  status: RoomJoinStatus;
  listeners: Set<() => void>;
}

function notifyListeners(entry: RoomEntry): void {
  for (const listener of entry.listeners) {
    listener();
  }
}

const isRefused = (status: RoomJoinStatus) => status === 'denied' || status === 'removed';

/**
 * The rooms a window holds, ref-counted across consumers, with the server's
 * answer to each join. Bookkeeping only: it says when a join or a leave must
 * be sent, and the provider owns the socket that sends it.
 *
 * A refused room (denied, or removed from) is not retried on its own: a new
 * consumer of a room another still holds inherits the refusal, and a
 * reconnect does not replay it. Access can be granted later, though (a
 * share), and `retryRefused` joins again when it may have been.
 */
export function createRoomRegistry({
  sendJoin,
  sendLeave,
}: {
  sendJoin: (roomId: string) => void;
  sendLeave: (roomId: string) => void;
}) {
  const rooms = new Map<string, RoomEntry>();

  return {
    /** Holds a room; the first holder joins it. Returns the release. */
    acquire(roomId: string, onStatusChange: () => void): () => void {
      let entry = rooms.get(roomId);
      if (!entry) {
        entry = { refCount: 0, status: 'joining', listeners: new Set() };
        rooms.set(roomId, entry);
        // If the socket is not open yet, the join replays on the next open.
        sendJoin(roomId);
      }
      const held = entry;
      held.refCount++;
      held.listeners.add(onStatusChange);
      return () => {
        held.refCount--;
        held.listeners.delete(onStatusChange);
        if (held.refCount > 0) return;
        // Dropping the entry (rather than keeping a refusal marker) is what
        // lets a future consumer attempt a fresh join.
        rooms.delete(roomId);
        if (!isRefused(held.status)) sendLeave(roomId);
      };
    },

    /** The room's join status, or null when nobody holds it. */
    status(roomId: string): RoomJoinStatus | null {
      return rooms.get(roomId)?.status ?? null;
    },

    /** The server answered a join, or removed this socket from the room. */
    applyLifecycle(roomId: string, frame: RoomLifecycleFrame): void {
      const entry = rooms.get(roomId);
      if (!entry) return;
      entry.status =
        frame === 'room_joined' ? 'joined' : frame === 'room_join_denied' ? 'denied' : 'removed';
      notifyListeners(entry);
    },

    /**
     * Joins a held room again if it was refused: access may have been granted
     * since (someone was just shared the work item). Returns whether it did.
     */
    retryRefused(roomId: string): boolean {
      const entry = rooms.get(roomId);
      if (!entry || !isRefused(entry.status)) return false;
      entry.status = 'joining';
      notifyListeners(entry);
      sendJoin(roomId);
      return true;
    },

    /** The socket closed: server-side membership died with it. */
    markDisconnected(): void {
      for (const entry of rooms.values()) {
        if (entry.status !== 'joined') continue;
        entry.status = 'joining';
        notifyListeners(entry);
      }
    },

    /** The socket opened: every held room to join again, refused ones excepted. */
    takeReplay(): string[] {
      const replay: string[] = [];
      for (const [roomId, entry] of rooms) {
        if (isRefused(entry.status)) continue;
        if (entry.status !== 'joining') {
          entry.status = 'joining';
          notifyListeners(entry);
        }
        replay.push(roomId);
      }
      return replay;
    },
  };
}

export type RoomRegistry = ReturnType<typeof createRoomRegistry>;
