import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { laneRunChangedChannel } from '@shared/events/laneRunEvents';
import { laneSetupChangedChannel } from '@shared/events/workItemEvents';
import type { LaneRunView, StartLaneRunError } from '@shared/lane-runs';
import type { Result } from '@shared/result';
import { describeRpcFailure } from '@renderer/features/work-list/describe-action-failure';
import { events, rpc } from '@renderer/lib/ipc';
import { queryClient } from '@renderer/lib/query-client';
import { describeStartError } from './run-model';

const laneRunViewKey = (laneId: string) => ['laneRuns', laneId] as const;

/**
 * Keeps every open Run tab current: a run change carries the lane's whole
 * run state, which replaces the cached one; a setup change refetches (the
 * tab shows setup's status).
 */
export function wireLaneRunInvalidation(): void {
  events.on(laneRunChangedChannel, (runs) => {
    queryClient.setQueryData<LaneRunView>(laneRunViewKey(runs.laneId), (view) =>
      view ? { ...view, runs } : view
    );
  });
  events.on(laneSetupChangedChannel, ({ worktreeId }) => {
    void queryClient.invalidateQueries({ queryKey: laneRunViewKey(worktreeId) });
  });
}

/** The Run tab's data for a lane; idle while there is no lane (a teammate, or loading). */
export function useLaneRunView(laneId: string | null) {
  return useQuery({
    queryKey: laneRunViewKey(laneId ?? ''),
    queryFn: async () => {
      const result = await rpc.laneRuns.get(laneId!);
      if (!result.success) throw new Error(describeRpcFailure('Read run state', result.error));
      return result.data;
    },
    enabled: laneId !== null,
  });
}

type StartResult = Result<unknown, StartLaneRunError | { type: 'solo_not_held' }>;

/**
 * Start / Stop / Restart / Run tests for one lane, each keyed by what it acts
 * on (`run:<id>` or `test`): which is on its way, and why the last start of
 * each did not run.
 */
export function useLaneRunActions(laneId: string) {
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});

  const perform = useCallback(async (key: string, action: () => Promise<StartResult | void>) => {
    setPending((current) => new Set(current).add(key));
    setErrors(({ [key]: _cleared, ...rest }) => rest);
    try {
      const result = await action();
      if (result && !result.success) {
        setErrors((current) => ({ ...current, [key]: describeStartError(result.error) }));
      }
    } finally {
      setPending((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }, []);

  return {
    pending,
    errors,
    start: (scriptId: string) =>
      perform(`run:${scriptId}`, () => rpc.laneRuns.start({ laneId, scriptId })),
    restart: (scriptId: string) =>
      perform(`run:${scriptId}`, () => rpc.laneRuns.restart({ laneId, scriptId })),
    stop: (scriptId: string) =>
      perform(`run:${scriptId}`, async () => {
        await rpc.laneRuns.stop({ laneId, scriptId });
      }),
    runTest: () => perform('test', () => rpc.laneRuns.runTest(laneId)),
    /** Start or Restart in the root, while this lane holds Solo. */
    restartInRoot: (scriptId: string) =>
      perform(`run:${scriptId}`, () => rpc.solo.restartRun({ laneId, scriptId })),
    /** Run tests in the root, while this lane holds Solo. */
    runTestInRoot: () => perform('test', () => rpc.solo.runTest(laneId)),
    stopTest: () =>
      perform('test', async () => {
        await rpc.laneRuns.stopTest(laneId);
      }),
  };
}
