import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { GitChange } from '@shared/git';
import type { LaneCommittedChanges } from '@shared/git-settings';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { filePathTab } from '@renderer/features/work-list/center-tab';
import { openCenterTab } from '@renderer/features/work-list/center-tabs-store';
import { describeRpcFailure } from '@renderer/features/work-list/describe-action-failure';
import { useWorkItemViewers } from '@renderer/features/work-list/use-viewing-presence';
import { rpc } from '@renderer/lib/ipc';
import { pickLaneSession, switchToSession } from '../focus-lane';
import { useRailScope } from '../rail-context';
import { PanelShell, RailEmpty, RailError } from '../rail-primitives';
import { useLiveWorktrees } from '../use-focused-worktree';
import {
  useWorktreeGitActions,
  useWorktreeLog,
  useWorktreeProject,
  useWorktreeStatus,
} from '../use-worktree-git';
import type { ChangesTreeInput } from './changes-tree';
import { ChangesTreeView } from './changes-tree-view';
import { CommitsSection } from './commits';
import { refreshChanges } from './refresh-changes';
import { ScopeRows, type ComparisonMode } from './scope-rows';

/** The committed view's name in the scope menu: the base it is measured against. */
function describeCompareBase(committed: LaneCommittedChanges): string {
  return committed.kind === 'ref' ? `vs ${committed.ref}` : 'vs upstream';
}

/**
 * Changes for the focused worktree: two scope rows, the changed files as a
 * tree, and recent commits.
 *
 * Committing is not here. The band above owns the whole ladder — Commit,
 * Publish, Push, Create PR — and opens the message in a popover reachable
 * from every tab, where the pinned box at the bottom of this panel could only
 * be reached from this one.
 *
 * Reads and writes go through `rpc.git.*` keyed by the worktree, not the
 * work item, so a second worktree shows its own tree rather than the primary's.
 */
export function SourceControlPanel() {
  const scope = useRailScope();
  const { worktreeId, layoutKey, workItemId } = scope;
  const worktrees = useLiveWorktrees(workItemId);
  const worktree = worktrees.find((row) => row.id === worktreeId) ?? null;
  // Path tabs name only non-primary worktrees (center-tab.ts).
  const tabWorktreeId = worktree && !worktree.isPrimary ? worktree.id : undefined;

  const projectQuery = useWorktreeProject(worktreeId);
  const projectId = projectQuery.data;

  const { status, error: statusError } = useWorktreeStatus(projectId, worktreeId);
  const log = useWorktreeLog(projectId, worktreeId);
  const viewers = useWorkItemViewers(workItemId);
  const sessionsByWorktree = useQuery({
    queryKey: ['agentSessions', workItemId],
    queryFn: async () => (await rpc.agentSessions.getAll(workItemId)).data.sessions,
    refetchInterval: 5000,
  });
  const actions = useWorktreeGitActions(projectId, worktreeId, workItemId);
  const queryClient = useQueryClient();

  const [comparison, setComparison] = useState<ComparisonMode>('uncommitted');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const baseBranch = worktree?.baseBranch ?? null;
  const { value: gitSettings } = useAppSettingsKey('git');
  const compareBaseMode = gitSettings?.compareBase ?? null;

  // The committed view is a different question than "what have I not
  // committed" — every change this branch's commits carry against the base
  // Settings › Git › Compare base names — so it is its own read, resolved in
  // main exactly as the sidebar's +/− is. Read even while hidden: the scope
  // menu names the base before it is chosen.
  const committed = useQuery({
    queryKey: ['rail', 'git', 'committed', worktreeId, compareBaseMode],
    queryFn: async () => {
      const result = await rpc.worktrees.getCommittedChanges(worktreeId as string);
      if (!result.success) {
        throw new Error(describeRpcFailure('Compare with base', result.error));
      }
      return result.data;
    },
    enabled: !!worktreeId && compareBaseMode !== null,
    refetchInterval: 15000,
  });

  const openDiff = useCallback(
    (filePath: string) => {
      setSelectedFile(filePath);
      openCenterTab(layoutKey, filePathTab(filePath, { worktreeId: tabWorktreeId, mode: 'diff' }), {
        preview: true,
      });
    },
    [layoutKey, tabWorktreeId]
  );

  const committedChanges: GitChange[] =
    committed.data?.kind === 'ref' ? committed.data.changes : [];
  const shownChanges: ChangesTreeInput =
    comparison === 'base'
      ? { staged: [], unstaged: committedChanges, conflicts: [], untracked: [] }
      : {
          staged: status?.staged ?? [],
          unstaged: status?.unstaged ?? [],
          conflicts: status?.conflicts ?? [],
          untracked: status?.untracked ?? [],
        };
  const noUpstream =
    comparison === 'base' && committed.data?.kind === 'no_upstream' ? committed.data : null;

  const totals = [
    ...shownChanges.staged,
    ...shownChanges.unstaged,
    ...shownChanges.conflicts,
    ...shownChanges.untracked,
  ].reduce(
    (sum, change) => ({
      added: sum.added + change.additions,
      removed: sum.removed + change.deletions,
    }),
    { added: 0, removed: 0 }
  );

  // There is no state here to set: focusing a worktree switches to a session in it.
  const focusWorktree = (id: string) => {
    const sessionId = pickLaneSession(id, worktrees, sessionsByWorktree.data ?? []);
    if (sessionId) switchToSession(sessionId);
  };

  if (projectQuery.error) {
    return (
      <PanelShell title="Changes">
        <RailError message={projectQuery.error.message} />
      </PanelShell>
    );
  }
  if (!worktreeId) {
    return (
      <PanelShell title="Changes">
        <RailEmpty>No worktree</RailEmpty>
      </PanelShell>
    );
  }

  return (
    <PanelShell title="Changes">
      <ScopeRows
        worktrees={worktrees}
        focusedWorktreeId={worktreeId}
        branchName={status?.currentBranch ?? worktree?.branchName ?? null}
        baseBranch={baseBranch}
        compareLabel={committed.data ? describeCompareBase(committed.data) : null}
        aheadCount={log.data?.aheadCount ?? null}
        comparison={comparison}
        onComparisonChange={setComparison}
        onFocusWorktree={focusWorktree}
        totals={totals}
        refreshing={actions.pending}
        onRefresh={() => void refreshChanges(queryClient, workItemId)}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {statusError instanceof Error && <RailError message={statusError.message} />}
        {actions.error && <RailError message={actions.error} />}
        {committed.error instanceof Error && <RailError message={committed.error.message} />}
        {noUpstream ? (
          <RailEmpty>
            {noUpstream.branch ?? 'This checkout'} has no upstream, so there is nothing pushed to
            compare against. Publish the branch, or set Compare base to Repository default in
            Settings › Git.
          </RailEmpty>
        ) : (
          // The group order is the user's (Settings › Git); until it is read
          // there is no order to draw in.
          gitSettings && (
            <ChangesTreeView
              changes={shownChanges}
              groupOrder={gitSettings.sourceControlGroupOrder}
              viewers={viewers}
              selectedFile={selectedFile}
              onOpenDiff={openDiff}
              actions={
                comparison === 'base'
                  ? null
                  : {
                      busy: actions.pending,
                      onStage: (filePath) => actions.run({ kind: 'stage', filePath }),
                      onUnstage: (filePath) => actions.run({ kind: 'unstage', filePath }),
                      onDiscard: (filePath) => actions.run({ kind: 'discard', filePath }),
                    }
              }
            />
          )
        )}
        <CommitsSection
          commits={log.data?.commits ?? []}
          layoutKey={layoutKey}
          worktreeId={worktreeId}
        />
      </div>
    </PanelShell>
  );
}
