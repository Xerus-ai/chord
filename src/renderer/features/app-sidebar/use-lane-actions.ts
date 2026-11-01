import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import type { SidebarWorktreeSummary } from '@shared/sidebar-summaries';
import type { ArchivedLane } from '@shared/worktrees';
import { openCenterTab } from '@renderer/features/work-list/center-tabs-store';
import { toastRpcFailure } from '@renderer/features/work-list/describe-action-failure';
import { announceWorkItemSessionsChanged } from '@renderer/features/work-list/use-work-item-sessions';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { describeArchivedLane, describeLaneArchiveConfirm } from './lane-archive-model';
import { describeLaneDeleteConfirm, pickLaneOpenTarget } from './lane-row-model';
import { forgetLaneGitReads, refreshLaneReaders } from './refresh-lane-readers';

export interface LaneActions {
  onOpenLane: (workItemId: string, lane: SidebarWorktreeSummary) => void;
  onPromoteLane: (workItemId: string, lane: SidebarWorktreeSummary) => void;
  onDeleteLane: (workItemId: string, lane: SidebarWorktreeSummary) => void;
  onArchiveLane: (workItemId: string, lane: SidebarWorktreeSummary) => void;
  /** Rejects with the reason, which the archived row shows in place. */
  restoreArchivedLane: (workItemId: string, laneId: string) => Promise<void>;
  onDeleteArchivedLane: (workItemId: string, lane: ArchivedLane) => void;
}

type LaneActionError = { type: string; message?: string; path?: string };

/** Refusals in the user's words; every other error carries its own message. */
function describeLaneError(error: LaneActionError): string {
  if (error.type === 'primary_worktree') {
    return 'This is the primary branch. Promote another branch first, or delete the work item.';
  }
  if (error.type === 'repo_checkout') {
    return `${error.path} is a repository's own checkout, so Chord will not remove it.`;
  }
  if (error.type === 'not_found') return 'The branch or its work item no longer exists.';
  if (error.type === 'branch_missing') return 'Its branch is gone, so there is nothing to restore.';
  if (error.type === 'branch_checked_out') return `The branch is checked out at ${error.path}.`;
  if (error.type === 'checkout_missing') return `${error.path} is no longer there.`;
  if (error.type === 'branch_not_deletable') {
    return "The branch has work its merged pull request doesn't, so it can't be deleted.";
  }
  return error.message ?? error.type;
}

/** Throws the RPC's own error: every caller reports it as a toast. */
async function startTerminalInLane(workItemId: string, laneId: string): Promise<string> {
  const shells = await rpc.terminalShells.list();
  if (!shells.success) throw new Error('Could not list installed shells');
  // The platform's default shell is listed first (the + launcher's order).
  const shell = shells.data.shells[0];
  if (!shell) throw new Error('No installed shell was found');
  const created = await rpc.agentSessions.createShellTerminal({
    workItemId,
    shell: shell.id,
    worktreeId: laneId,
  });
  if (!created.success) throw new Error(describeLaneError(created.error));
  return created.data.session.id;
}

/**
 * The left rail's lane actions (plan P16). Open activates something running
 * in the lane, because the centre's focused lane is the one behind its active
 * tab (`use-focused-worktree.ts`). Promote, Archive, Restore and Delete
 * refresh every reader of a work item's lanes (`refreshLaneReaders`).
 */
export function useLaneActions(openWorkItem: (workItemId: string) => void): LaneActions {
  const queryClient = useQueryClient();
  const showConfirm = useShowModal('confirmActionModal');

  const refreshLanes = useCallback(
    (workItemId: string) => {
      void refreshLaneReaders(queryClient, workItemId);
      announceWorkItemSessionsChanged(workItemId);
    },
    [queryClient]
  );

  const openLane = useCallback(
    async (workItemId: string, lane: SidebarWorktreeSummary) => {
      const listed = await rpc.agentSessions.getAll(workItemId);
      if (!listed.success) throw new Error('Could not read the work item’s sessions');
      const target = pickLaneOpenTarget(lane, listed.data.sessions);
      const sessionId =
        target.kind === 'session'
          ? target.sessionId
          : await startTerminalInLane(workItemId, lane.id);
      openCenterTab(workItemId, { kind: 'session', sessionId });
      openWorkItem(workItemId);
      refreshLanes(workItemId);
    },
    [openWorkItem, refreshLanes]
  );

  const promoteLane = useCallback(
    async (workItemId: string, lane: SidebarWorktreeSummary) => {
      const result = await rpc.worktrees.promoteToPrimary(lane.id);
      if (!result.success) throw new Error(describeLaneError(result.error));
      refreshLanes(workItemId);
    },
    [refreshLanes]
  );

  const deleteLane = useCallback(
    async (workItemId: string, lane: Pick<SidebarWorktreeSummary, 'id'>) => {
      const result = await rpc.worktrees.remove(lane.id);
      if (!result.success) throw new Error(describeLaneError(result.error));
      refreshLanes(workItemId);
    },
    [refreshLanes]
  );

  // The confirm must say what is lost, so a lane whose state can't be read
  // is reported rather than offered for deletion blind.
  const confirmDeleteLane = useCallback(
    async (workItemId: string, lane: SidebarWorktreeSummary) => {
      const inspected = await rpc.worktrees.inspectArchive(lane.id);
      if (!inspected.success) {
        throw new Error(describeLaneError(inspected.error));
      }
      const copy = describeLaneDeleteConfirm({ branch: lane.branch, inspection: inspected.data });
      showConfirm({
        ...copy,
        confirmLabel: 'Delete',
        variant: 'destructive',
        onSuccess: () => {
          deleteLane(workItemId, lane).catch((error: Error) =>
            toastRpcFailure('Delete branch', error.message)
          );
        },
      });
    },
    [showConfirm, deleteLane]
  );

  const showArchive = useShowModal('archiveLaneDialog');

  // The confirm says what is kept, and offers the branch only when nothing is lost.
  const confirmArchiveLane = useCallback(
    async (workItemId: string, lane: SidebarWorktreeSummary) => {
      const inspected = await rpc.worktrees.inspectArchive(lane.id);
      if (!inspected.success) throw new Error(describeLaneError(inspected.error));
      showArchive({
        ...describeLaneArchiveConfirm({ branch: lane.branch, inspection: inspected.data }),
        onSuccess: ({ deleteBranch }) => {
          void rpc.worktrees
            .archive({ worktreeId: lane.id, deleteBranch })
            .then((result) => {
              if (!result.success) throw new Error(describeLaneError(result.error));
              refreshLanes(workItemId);
            })
            .catch((error: Error) => toastRpcFailure('Archive branch', error.message));
        },
      });
    },
    [showArchive, refreshLanes]
  );

  const restoreArchivedLane = useCallback(
    async (workItemId: string, laneId: string) => {
      // Before the lane can read as live again, not after: see forgetLaneGitReads.
      forgetLaneGitReads(queryClient, laneId);
      const result = await rpc.worktrees.restore(laneId);
      if (!result.success) throw new Error(describeLaneError(result.error));
      refreshLanes(workItemId);
    },
    [queryClient, refreshLanes]
  );

  const confirmDeleteArchivedLane = useCallback(
    (workItemId: string, lane: ArchivedLane) => {
      const { label } = describeArchivedLane(lane);
      showConfirm({
        title: `Delete ${label}?`,
        description:
          "Deletes this archived branch's record, its kept uncommitted files and its history checkpoints from this machine. The branch itself stays in the repository.",
        confirmLabel: 'Delete',
        variant: 'destructive',
        onSuccess: () => {
          deleteLane(workItemId, { id: lane.id }).catch((error: Error) =>
            toastRpcFailure('Delete branch', error.message)
          );
        },
      });
    },
    [showConfirm, deleteLane]
  );

  return useMemo(
    () => ({
      onOpenLane: (workItemId, lane) => {
        openLane(workItemId, lane).catch((error: Error) =>
          toastRpcFailure('Open branch', error.message)
        );
      },
      onPromoteLane: (workItemId, lane) => {
        promoteLane(workItemId, lane).catch((error: Error) =>
          toastRpcFailure('Promote branch', error.message)
        );
      },
      onDeleteLane: (workItemId, lane) => {
        confirmDeleteLane(workItemId, lane).catch((error: Error) =>
          toastRpcFailure('Delete branch', error.message)
        );
      },
      onArchiveLane: (workItemId, lane) => {
        confirmArchiveLane(workItemId, lane).catch((error: Error) =>
          toastRpcFailure('Archive branch', error.message)
        );
      },
      restoreArchivedLane,
      onDeleteArchivedLane: confirmDeleteArchivedLane,
    }),
    [
      openLane,
      promoteLane,
      confirmDeleteLane,
      confirmArchiveLane,
      restoreArchivedLane,
      confirmDeleteArchivedLane,
    ]
  );
}
