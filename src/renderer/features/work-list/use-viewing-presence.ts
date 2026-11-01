import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cloudApi } from '@renderer/lib/cloud-api';
import { CloudApiError } from '@renderer/lib/cloud-fetch';
import { useAccountSession } from '@renderer/lib/hooks/useAccount';
import { useSyncSocketContext } from '@renderer/lib/sync/sync-socket-provider';
import { useWorkItemRoom } from '@renderer/lib/sync/use-work-item-room';
import {
  clearWorkItemPresenceGate,
  parkWorkItemPresence,
  shouldFetchWorkItemPresence,
} from '@renderer/lib/sync/work-item-presence-gate';
import { presencePayload, type PresenceState } from './viewing-presence-state';

export interface WorkItemViewer {
  user_id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  file: string;
  last_seen: string;
}

const REFRESH_DEBOUNCE_MS = 1_000;
// Seed rows older than this are ghosts from a server that died without
// flipping them offline — same liveness window /presence/online-users uses.
const SEED_LIVENESS_MS = 5 * 60 * 1000;

// Viewer state is keyed by the work item it was collected for, so entries
// from a previously watched work item never leak into the current one.
interface ViewersState {
  workItemId: string;
  viewers: Map<string, WorkItemViewer>;
}

const NO_VIEWERS: WorkItemViewer[] = [];

/**
 * Live "who is viewing which file" feed for one work item: seeded from
 * GET /presence/:work_item_id (reseeded on every socket reconnect), then
 * driven by presence_changed / member_left over the shared sync socket.
 * Holds the work item's WS room so the broadcasts reach this window even
 * when no other consumer has it open.
 */
export function useWorkItemViewers(workItemId: string | undefined): WorkItemViewer[] {
  const { subscribeEvent } = useSyncSocketContext();
  const { data: session } = useAccountSession();
  const selfId = session?.user?.userId ?? null;
  useWorkItemRoom(workItemId);
  const [state, setState] = useState<ViewersState | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshSeqRef = useRef(0);
  // Mirror read by the long-lived socket handlers below, so deciding whether
  // a broadcast is about a viewer we already hold never has to happen inside
  // a setState updater (updaters must stay pure — React may run them twice)
  // and never has to resubscribe the socket on every state change.
  const stateRef = useRef<ViewersState | null>(null);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const refresh = useCallback(() => {
    if (!workItemId) return;
    if (!shouldFetchWorkItemPresence(workItemId)) return;
    const seq = ++refreshSeqRef.current;
    cloudApi
      .getPresenceForWorkItem(workItemId)
      .then((rows) => {
        clearWorkItemPresenceGate(workItemId);
        if (seq !== refreshSeqRef.current) return; // superseded by a newer refresh
        const cutoff = Date.now() - SEED_LIVENESS_MS;
        const viewers = new Map<string, WorkItemViewer>();
        for (const row of rows) {
          const file = row.cursor_position?.file;
          if (!file || row.status !== 'online' || row.user_id === selfId) continue;
          if (new Date(row.last_seen).getTime() < cutoff) continue;
          viewers.set(row.user_id, {
            user_id: row.user_id,
            email: row.email,
            name: row.name,
            avatar_url: row.avatar_url,
            file,
            last_seen: row.last_seen,
          });
        }
        setState({ workItemId, viewers });
      })
      .catch((err: Error) => {
        // A work item that has not reached the cloud yet has no presence
        // endpoint. That is an expected state, not a failure — park it so
        // every later trigger stops refetching (and stops logging) until the
        // room join confirms the cloud row exists.
        if (err instanceof CloudApiError && err.status === 404) {
          parkWorkItemPresence(workItemId);
          return;
        }
        console.error('[presence] work-item presence fetch failed:', err.message);
      });
  }, [workItemId, selfId]);

  // Events about users we don't hold a row for carry no email/name — one
  // debounced refetch enriches them once their row is persisted (the server
  // persists presence fire-and-forget after broadcasting).
  const scheduleRefresh = useCallback(() => {
    if (debounceRef.current) return;
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      refresh();
    }, REFRESH_DEBOUNCE_MS);
  }, [refresh]);

  useEffect(() => {
    refresh();
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [refresh]);

  useEffect(() => {
    if (!workItemId) return;

    const removeViewer = (userId: string) => {
      setState((prev) => {
        if (!prev || prev.workItemId !== workItemId || !prev.viewers.has(userId)) return prev;
        const viewers = new Map(prev.viewers);
        viewers.delete(userId);
        return { workItemId, viewers };
      });
    };

    const unsubscribes = [
      subscribeEvent(
        'presence_changed',
        (payload) => {
          if (payload.user_id === selfId) return;
          const file = payload.cursor_position?.file;
          if (payload.status !== 'online' || !file) {
            removeViewer(payload.user_id);
            return;
          }
          // A user we hold no row for carries no email/name on this event —
          // enrich them with one debounced refetch instead of fabricating a
          // partial viewer. Decided outside the updater: scheduling a fetch
          // is a side effect, and the updater must stay pure.
          const current = stateRef.current;
          if (
            !current ||
            current.workItemId !== workItemId ||
            !current.viewers.has(payload.user_id)
          ) {
            scheduleRefresh();
            return;
          }
          setState((prev) => {
            if (!prev || prev.workItemId !== workItemId) return prev;
            const known = prev.viewers.get(payload.user_id);
            if (!known) return prev;
            const viewers = new Map(prev.viewers);
            viewers.set(payload.user_id, { ...known, file, last_seen: payload.last_seen });
            return { workItemId, viewers };
          });
        },
        workItemId
      ),
      // A user's final disconnect emits only an org-scoped event
      // (work_item_id null), which the room-scoped channel never sees.
      subscribeEvent('presence_changed', (payload) => {
        if (payload.work_item_id === null && payload.status === 'offline') {
          removeViewer(payload.user_id);
        }
      }),
      // member_left carries no work_item_id, so it only reaches the global
      // channel; a socket leaving the room means that window closed the item.
      subscribeEvent('member_left', (payload) => {
        if (payload.roomId === `work_item:${workItemId}`) removeViewer(payload.userId);
      }),
      subscribeEvent('$sync/connected', refresh),
    ];
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [workItemId, selfId, subscribeEvent, scheduleRefresh, refresh]);

  return useMemo(() => {
    if (!state || state.workItemId !== workItemId || state.viewers.size === 0) return NO_VIEWERS;
    return Array.from(state.viewers.values());
  }, [state, workItemId]);
}

/**
 * The ONE writer of this user's presence row on a work item: the view calls
 * it with its focused tab's state (viewing-presence-state.ts). A second writer
 * on the same row would clear the first's file on unmount. Emits once the
 * work item's room is joined (a denied or unsynced item never emits),
 * re-emits after every reconnect (the join status round-trips through
 * 'joining') and on every change of the focused tab, and clears the advertised
 * file on unmount so teammates' rings don't go stale. No work item (an
 * artifact shared on its own) advertises nothing.
 */
export function useWorkItemPresenceSender(
  workItemId: string | undefined,
  state: PresenceState
): void {
  const { sendEvent } = useSyncSocketContext();
  const roomStatus = useWorkItemRoom(workItemId);
  const joined = roomStatus === 'joined';
  const advertisedRef = useRef(false);
  const { file, view } = state;

  useEffect(() => {
    if (!joined || !workItemId) return;
    const sent = sendEvent({
      type: 'presence_update',
      payload: presencePayload(workItemId, { file, view }),
    });
    if (sent) advertisedRef.current = true;
  }, [joined, workItemId, file, view, sendEvent]);

  useEffect(() => {
    return () => {
      if (!advertisedRef.current || !workItemId) return;
      advertisedRef.current = false;
      // Omitting cursor_position/active_view nulls them server-side.
      sendEvent({
        type: 'presence_update',
        payload: { work_item_id: workItemId, status: 'online' },
      });
    };
  }, [workItemId, sendEvent]);
}
