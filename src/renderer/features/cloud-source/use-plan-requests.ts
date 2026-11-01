import type { CloudPlanRequest } from '@chord/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cloudApi } from '@renderer/lib/cloud-api';
import { useSyncSocketContext } from '@renderer/lib/sync/sync-socket-provider';

interface ScopedRequests {
  workItemId: string;
  entries: ReadonlyMap<string, CloudPlanRequest>;
}

const EMPTY_REQUESTS: readonly CloudPlanRequest[] = [];

export function usePlanRequests(workItemId: string): readonly CloudPlanRequest[] {
  const { subscribeEvent } = useSyncSocketContext();
  const [state, setState] = useState<ScopedRequests | null>(null);
  const stateRef = useRef<ScopedRequests | null>(null);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const applySeed = useCallback((scopeId: string, rows: CloudPlanRequest[]) => {
    setState((prev) => {
      // Same reasoning as usePermissionRequests' applySeed: the seed is
      // status=pending only, so rows this window already watched resolve must
      // be carried forward instead of dropped on every reconnect.
      const entries = new Map<string, CloudPlanRequest>();
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
          status: payload.status as CloudPlanRequest['status'],
          resolved_by: payload.resolved_by,
          resolution: payload.resolution as CloudPlanRequest['resolution'],
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
        .getPlanRequests(workItemId, 'pending')
        .then((rows) => {
          if (!cancelled) applySeed(workItemId, rows);
        })
        .catch((err: Error) => {
          console.error('[plans] request seed failed:', err.message);
        });
    };
    seed();

    const unsubscribeUpdated = subscribeEvent(
      'plan_request_updated',
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
