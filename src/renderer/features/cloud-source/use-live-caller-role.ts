import { useEffect, useState } from 'react';
import { useAccountSession } from '@renderer/lib/hooks/useAccount';
import { useSyncSocketContext } from '@renderer/lib/sync/sync-socket-provider';

/** The live override participant_role_changed installs over the item's `caller_role`. */
interface LiveRole {
  workItemId: string;
  role: string;
}

/**
 * This viewer's role as the owner changes it, or null until they do. The
 * owner demoting this account to viewer must close the composer now, not
 * whenever the work-item query behind `caller_role` next refetches — the
 * server already refuses the writes (authorizeWorkItemWrite) and has force-
 * closed this user's live Yjs sessions (sharing.ts → disconnectUserFrom-
 * WorkItem). Promotion re-opens it the same way. The view re-resolves its
 * capabilities from it (`cloudViewerAccess`).
 */
export function useLiveCallerRole(workItemId: string): string | null {
  const { subscribeEvent } = useSyncSocketContext();
  const { data: accountSession } = useAccountSession();
  const selfUserId = accountSession?.user?.userId ?? null;
  const [liveRole, setLiveRole] = useState<LiveRole | null>(null);

  useEffect(() => {
    if (!selfUserId) return;
    return subscribeEvent(
      'participant_role_changed',
      (payload) => {
        if (payload.user_id !== selfUserId) return;
        setLiveRole({ workItemId, role: payload.role });
      },
      workItemId
    );
  }, [subscribeEvent, workItemId, selfUserId]);

  return liveRole && liveRole.workItemId === workItemId ? liveRole.role : null;
}
