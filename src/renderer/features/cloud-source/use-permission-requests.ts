import type { CloudPermissionRequest } from '@chord/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cloudApi } from '@renderer/lib/cloud-api';
import { useSyncSocketContext } from '@renderer/lib/sync/sync-socket-provider';

interface ScopedRequests {
  workItemId: string;
  entries: ReadonlyMap<string, CloudPermissionRequest>;
}

const EMPTY_REQUESTS: readonly CloudPermissionRequest[] = [];

/**
 * Live pending permission requests for the participant card (design §5):
 * REST seed (GET /permission-requests?status=pending), then room-scoped
 * permission_request_updated transitions, reseeded on every reconnect
 * (transitions broadcast while disconnected are lost frames, the rows
 * behind them are not). The event carries only the transition — tool name,
 * input, and options never ride it — so a pending event for an unknown
 * request triggers a reseed rather than fabricating a partial row. A
 * transition to resolved/expired keeps the row so an on-screen card
 * disables its buttons instead of vanishing mid-glance. Mirrors
 * use-command-statuses' workItemId-scoped state.
 */
export function usePermissionRequests(workItemId: string): readonly CloudPermissionRequest[] {
  const { subscribeEvent } = useSyncSocketContext();
  const [state, setState] = useState<ScopedRequests | null>(null);
  // Mirror for the socket handler's "do we know this request?" check —
  // resubscribing per state change would drop frames mid-swap. A stale read
  // only ever costs a redundant reseed, never a lost transition.
  const stateRef = useRef<ScopedRequests | null>(null);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const applySeed = useCallback((scopeId: string, rows: CloudPermissionRequest[]) => {
    setState((prev) => {
      // The seed asks for status=pending only, so a request this window
      // already watched resolve is absent from it. Wholesale-replacing would
      // drop those rows on every reconnect — and with them the resolved card
      // that is supposed to stay put with disabled buttons rather than vanish
      // mid-glance. Carry them forward; the pending rows come from the seed.
      const entries = new Map<string, CloudPermissionRequest>();
      if (prev && prev.workItemId === scopeId) {
        for (const [id, row] of prev.entries) {
          if (row.status !== 'pending') entries.set(id, row);
        }
      }
      for (const row of rows) entries.set(row.request_id, row);
      return { workItemId: scopeId, entries };
    });
  }, []);

  const applyTransition = useCallback(
    (
      scopeId: string,
      payload: {
        request_id: string;
        status: string;
        resolved_by: string | null;
        resolution: string | null;
      }
    ) => {
      setState((prev) => {
        if (!prev || prev.workItemId !== scopeId) return prev;
        const existing = prev.entries.get(payload.request_id);
        if (!existing) return prev;
        const entries = new Map(prev.entries);
        entries.set(payload.request_id, {
          ...existing,
          status: payload.status as CloudPermissionRequest['status'],
          resolved_by: payload.resolved_by,
          resolution: payload.resolution as CloudPermissionRequest['resolution'],
        });
        return { workItemId: scopeId, entries };
      });
    },
    []
  );

  useEffect(() => {
    let cancelled = false;

    const seed = () => {
      cloudApi
        .getPermissionRequests(workItemId, 'pending')
        .then((rows) => {
          if (!cancelled) applySeed(workItemId, rows);
        })
        .catch((err: Error) => {
          console.error('[permissions] request seed failed:', err.message);
        });
    };
    seed();

    const unsubscribeUpdated = subscribeEvent(
      'permission_request_updated',
      (payload) => {
        const known =
          stateRef.current?.workItemId === workItemId &&
          stateRef.current.entries.has(payload.request_id);
        if (payload.status === 'pending' && !known) {
          seed();
          return;
        }
        applyTransition(workItemId, payload);
      },
      workItemId
    );
    const unsubscribeConnected = subscribeEvent('$sync/connected', seed);

    return () => {
      cancelled = true;
      unsubscribeUpdated();
      unsubscribeConnected();
    };
  }, [workItemId, subscribeEvent, applySeed, applyTransition]);

  if (!state || state.workItemId !== workItemId) return EMPTY_REQUESTS;
  return [...state.entries.values()];
}
