import { useCallback, useSyncExternalStore } from 'react';
import type { RoomJoinStatus } from './room-registry';
import { useSyncSocketContext } from './sync-socket-provider';

const noopUnsubscribe = () => {};

/**
 * Holds membership in the work item's WS room for the lifetime of the caller:
 * join_room on mount/change, leave_room on unmount/change. Reconnect replay
 * and denied/removed handling live in the provider; the room status is read
 * from it as an external store.
 */
export function useWorkItemRoom(workItemId: string | undefined): RoomJoinStatus | null {
  const { acquireWorkItemRoom, getWorkItemRoomStatus } = useSyncSocketContext();

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!workItemId) return noopUnsubscribe;
      return acquireWorkItemRoom(workItemId, onStoreChange);
    },
    [workItemId, acquireWorkItemRoom]
  );

  const getSnapshot = useCallback(
    () => (workItemId ? getWorkItemRoomStatus(workItemId) : null),
    [workItemId, getWorkItemRoomStatus]
  );

  return useSyncExternalStore(subscribe, getSnapshot);
}
