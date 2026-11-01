import { useMemo } from 'react';
import type { WorkItemRow } from '@main/db/schema-work-items';
import { useLanePullRequests } from '@renderer/features/work-list/use-lane-pull-requests';
import { useWorkItemSource } from '@renderer/features/work-list/work-item-source';
import type { StatusSignal } from '@renderer/lib/status-dot';
import { StatusBand } from './band/band';
import { selectFocusedLane, toLanePrState } from './band/lane-band-input';
import { useBandModel } from './band/use-band-model';
import { useDefaultPanel } from './band/use-default-panel';
import { ChecksPrPanel } from './checks-pr/panel';
import { computeReviewAggregate, useLaneChecks, useLaneReviews } from './checks-pr/pr-data';
import { ExplorerPanel } from './explorer/explorer-panel';
import { RailPanels, WorkItemRail } from './rail';
import { useRailScope, type RailScope } from './rail-context';
import type { RailPanelId } from './rail-store';
import { deriveRunTabSignal } from './run/run-model';
import { RunPanel } from './run/run-panel';
import { useLaneRunView } from './run/use-lane-runs';
import { SourceControlPanel } from './source-control/panel';
import { deriveChecksSignal } from './status-dot';
import { useFocusedWorktreeId } from './use-focused-worktree';
import { WorkItemPanel } from './work-item/panel';

/** The owner's rail: this machine's worktree, git state and pull request. */
export function LocalWorkItemRail({ workItem }: { workItem: WorkItemRow }) {
  const worktreeId = useFocusedWorktreeId(workItem.id, workItem.id);
  const scope = useMemo<RailScope>(
    () => ({ workItemId: workItem.id, layoutKey: workItem.id, worktreeId }),
    [workItem.id, worktreeId]
  );
  return (
    <WorkItemRail scope={scope}>
      <LocalRailBody workItem={workItem} />
    </WorkItemRail>
  );
}

/**
 * Inside the scope provider, because the band reads the focused worktree the
 * same way the panels do. The band model is read here rather than inside the
 * band because the tabs need the same numbers it does — how many files are
 * uncommitted, and whether a check is failing — and polling them twice to
 * show them twice is how the old rail ended up with a Commit button in three
 * places.
 */
function LocalRailBody({ workItem }: { workItem: WorkItemRow }) {
  const { capabilities } = useWorkItemSource();
  const model = useBandModel(workItem);
  useDefaultPanel(workItem.id, model.changedCount > 0, model.ready);
  const signals = useRailStatusSignals(workItem);

  return (
    <>
      <StatusBand
        workItemId={workItem.id}
        state={model.state}
        prNumber={model.prNumber}
        prUrl={model.prUrl}
        // Mark done, merge and the ladder act on the item: the owner's to run.
        actions={capabilities.editItem ? model : null}
        syncedAt={null}
      />
      <RailPanels
        signals={signals}
        counts={{ 'source-control': model.changedCount }}
        renderPanel={(panel) => <LocalRailPanel panel={panel} workItem={workItem} />}
      />
    </>
  );
}

function LocalRailPanel({ panel, workItem }: { panel: RailPanelId; workItem: WorkItemRow }) {
  switch (panel) {
    case 'work-item':
      return <WorkItemPanel workItem={workItem} />;
    case 'explorer':
      return <ExplorerPanel />;
    case 'source-control':
      return <SourceControlPanel />;
    case 'checks-pr':
      return <ChecksPrPanel workItem={workItem} />;
    case 'run':
      return <RunPanel />;
  }
}

/**
 * The dots on the Checks and Run tabs. The colour table is the shared one
 * (`@renderer/lib/status-dot`); what is derived here is the signal: from the
 * focused lane's PR (its CI and review state), and from the focused lane's
 * processes (`deriveRunTabSignal`). `deriveWorkItemStatus` answers a different
 * question — which bucket the whole work item is in — and that is the
 * sidebar's row, not this icon.
 */
function useRailStatusSignals(workItem: WorkItemRow): Partial<Record<RailPanelId, StatusSignal>> {
  const { worktreeId } = useRailScope();
  const checks = useLaneChecks(workItem.id, worktreeId);
  const reviews = useLaneReviews(workItem.id, worktreeId);
  const lanes = useLanePullRequests(workItem.id);
  const pr = selectFocusedLane(lanes.data, worktreeId)?.pr ?? null;
  const runs = useLaneRunView(worktreeId).data?.runs;

  return useMemo(() => {
    const run = deriveRunTabSignal(runs);
    if (!pr) return { run };
    const reviewRows = reviews.data ?? [];
    return {
      run,
      'checks-pr': deriveChecksSignal({
        checks: checks.data?.checks ?? [],
        reviewState: reviewRows.length > 0 ? computeReviewAggregate(reviewRows).state : null,
        prState: toLanePrState(pr),
      }),
    };
  }, [pr, checks.data, reviews.data, runs]);
}
