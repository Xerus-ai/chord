import type { CloudCommand } from '@chord/protocol';
import { useCallback, useEffect, useState } from 'react';
import { cloudApi } from '@renderer/lib/cloud-api';
import { useSyncSocketContext } from '@renderer/lib/sync/sync-socket-provider';

export interface CommandStatusEntry {
  status: string;
  status_reason: string | null;
}

interface ScopedStatuses {
  workItemId: string;
  entries: ReadonlyMap<string, CommandStatusEntry>;
}

const EMPTY_STATUSES: ReadonlyMap<string, CommandStatusEntry> = new Map();

/**
 * Live command-status map for one work item's status chips: REST seed
 * (GET /commands), then room-scoped command_updated transitions, reseeded on
 * every reconnect (transitions broadcast while disconnected are lost frames,
 * the rows behind them are not). State is scoped by workItemId — a stale
 * item's map is simply never read, so switching items needs no effect-time
 * reset. recordCommand seeds a just-POSTed command without a round trip.
 */
export function useCommandStatuses(workItemId: string): {
  statuses: ReadonlyMap<string, CommandStatusEntry>;
  recordCommand: (command: CloudCommand) => void;
} {
  const { subscribeEvent } = useSyncSocketContext();
  const [state, setState] = useState<ScopedStatuses | null>(null);

  const applyRows = useCallback(
    (scopeId: string, rows: { id: string; status: string; status_reason: string | null }[]) => {
      setState((prev) => {
        const base = prev && prev.workItemId === scopeId ? prev.entries : EMPTY_STATUSES;
        const next = new Map(base);
        for (const row of rows) {
          next.set(row.id, { status: row.status, status_reason: row.status_reason });
        }
        return { workItemId: scopeId, entries: next };
      });
    },
    []
  );

  useEffect(() => {
    let cancelled = false;

    const seed = () => {
      cloudApi
        .getCommands(workItemId)
        .then((rows) => {
          if (!cancelled) applyRows(workItemId, rows);
        })
        .catch((err: Error) => {
          console.error('[commands] status seed failed:', err.message);
        });
    };
    seed();

    const unsubscribeUpdated = subscribeEvent(
      'command_updated',
      (payload) => applyRows(workItemId, [payload]),
      workItemId
    );
    const unsubscribeConnected = subscribeEvent('$sync/connected', seed);

    return () => {
      cancelled = true;
      unsubscribeUpdated();
      unsubscribeConnected();
    };
  }, [workItemId, subscribeEvent, applyRows]);

  const recordCommand = useCallback(
    (command: CloudCommand) => applyRows(command.work_item_id, [command]),
    [applyRows]
  );

  return {
    statuses: state && state.workItemId === workItemId ? state.entries : EMPTY_STATUSES,
    recordCommand,
  };
}
