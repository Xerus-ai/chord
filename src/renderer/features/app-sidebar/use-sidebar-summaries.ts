import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  agentEventChannel,
  agentSessionsChangedChannel,
  type AgentEventEnvelope,
} from '@shared/events/agentEvents';
import type { SidebarSummary } from '@shared/sidebar-summaries';
import { turnStreamChannel, type TurnStreamEvent } from '@shared/stream-items';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { events, rpc } from '@renderer/lib/ipc';
import { useLiveWorktreeStatus, useLiveWorktreeStatusStore } from './live-worktree-status-store';
import {
  invalidateSidebarSummariesFor,
  sidebarSummariesQueryOptions,
} from './sidebar-summaries-query';

export function useSidebarSummaries(workItemIds: string[]) {
  const stableKey = workItemIds.join(',');
  // The caller rebuilds its id array on every 5s poll. Deriving the ids from
  // the key keeps the identity stable, so the agent-event listeners below are
  // registered once per real membership change instead of once per poll.
  const ids = useMemo(() => (stableKey === '' ? [] : stableKey.split(',')), [stableKey]);

  // Each lane's +/− is counted against Settings › Git › Compare base, so a
  // change to it is a different answer, read at once rather than at the next poll.
  const { value: gitSettings } = useAppSettingsKey('git');
  const compareBaseMode = gitSettings?.compareBase ?? null;

  const { data, isPending, error } = useQuery(
    sidebarSummariesQueryOptions({
      stableKey,
      compareBaseMode,
      fetchSummaries: async () => {
        const result = await rpc.workItems.getSidebarSummaries(ids);
        if (!result.success) throw new Error('workItems.getSidebarSummaries failed');
        return result.data.summaries as SidebarSummary[];
      },
    })
  );

  const [runningSeedError, setRunningSeedError] = useState<string | null>(null);

  const handleAgentEvent = useCallback((envelope: AgentEventEnvelope) => {
    useLiveWorktreeStatusStore.getState().applyAgentEvent(envelope.event);
  }, []);

  const handleTurnStreamEvent = useCallback((event: TurnStreamEvent) => {
    useLiveWorktreeStatusStore.getState().applyTurnStreamEvent(event);
  }, []);

  // A session started, ended or was created elsewhere (the tab, the rail, a
  // first prompt): its rows are read now, not at the next 10s poll.
  const queryClient = useQueryClient();
  const handleSessionsChanged = useCallback(
    ({ workItemId }: { workItemId: string }) => {
      void invalidateSidebarSummariesFor(queryClient, workItemId);
    },
    [queryClient]
  );

  // Agent events only reveal work items/sessions that emit while this hook is
  // mounted, so anything already running was invisible until its next event.
  // One snapshot of the live sessions at mount fixes that; the event stream
  // stays authoritative for every transition after it (see live-worktree-
  // status-reducer's "stopped wins over a late seed" guard).
  useEffect(() => {
    let cancelled = false;
    rpc.agentSessions.listRunningSessions().then(
      (result) => {
        if (cancelled) return;
        setRunningSeedError(null);
        useLiveWorktreeStatusStore.getState().applySeed(result.data.sessions);
      },
      (error: unknown) => {
        if (cancelled) return;
        setRunningSeedError(
          error instanceof Error ? error.message : 'Could not read running agents.'
        );
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // Same problem as the running-session seed above, but for the needs-input
  // dot: a permission/plan card already pending when this hook mounts is
  // otherwise invisible until the session's next turn-stream event.
  useEffect(() => {
    let cancelled = false;
    rpc.agentSessions.listPendingInputSessions().then(
      (result) => {
        if (cancelled) return;
        useLiveWorktreeStatusStore.getState().applyPendingInputSeed(result.data.sessions);
      },
      (error: unknown) => {
        if (!cancelled) {
          console.error(
            '[sidebar] pending-input seed failed:',
            error instanceof Error ? error.message : error
          );
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (ids.length === 0) return;

    const cleanups: (() => void)[] = [];
    for (const wid of ids) {
      cleanups.push(events.on(agentEventChannel, handleAgentEvent, wid));
      // Chat sessions surface permission and plan requests only as turn-stream items.
      cleanups.push(events.on(turnStreamChannel, handleTurnStreamEvent, wid));
      cleanups.push(events.on(agentSessionsChangedChannel, handleSessionsChanged, wid));
    }
    return () => cleanups.forEach((fn) => fn());
  }, [ids, handleAgentEvent, handleTurnStreamEvent, handleSessionsChanged]);

  const summaryMap = useMemo(() => {
    const map = new Map<string, SidebarSummary>();
    if (data) {
      for (const s of data) map.set(s.id, s);
    }
    return map;
  }, [data]);

  const { runningWorkItemIds, isWorktreeStreaming } = useLiveWorktreeStatus();

  return {
    summaryMap,
    runningIds: runningWorkItemIds,
    runningSeedError,
    isPending,
    error,
    isWorktreeStreaming,
  };
}
