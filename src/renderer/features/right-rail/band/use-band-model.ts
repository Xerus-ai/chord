import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import type { GitAiAgent } from '@shared/git-ai';
import type { ArtifactStatus } from '@main/core/artifacts/artifact-utils';
import type { ArtifactRow } from '@main/db/schema-artifacts';
import type { WorkItemRow } from '@main/db/schema-work-items';
import {
  invalidateWorkItemArtifacts,
  useWorkItemArtifacts,
} from '@renderer/features/artifacts/use-work-item-artifacts';
import { useGitAiGeneration, useGitAiSettings } from '@renderer/features/git-ai/use-git-ai';
import { getFocusedPane } from '@renderer/features/work-list/center-layout';
import { useCenterLayout } from '@renderer/features/work-list/center-tabs-store';
import { useGitActions } from '@renderer/features/work-list/use-git-actions';
import { useLanePullRequests } from '@renderer/features/work-list/use-lane-pull-requests';
import { useLanePrActions, type MergeStrategy } from '@renderer/features/work-list/use-pr-actions';
import { rpc } from '@renderer/lib/ipc';
import { computeReviewAggregate, useLaneChecks, useLaneReviews } from '../checks-pr/pr-data';
import { useAgentHandoff } from '../handoff';
import { useRailScope } from '../rail-context';
import { useLiveWorktrees } from '../use-focused-worktree';
import {
  useWorktreeGitActions,
  useWorktreeLog,
  useWorktreeProject,
  useWorktreeStatus,
} from '../use-worktree-git';
import { selectBandAction, type BandAction, type BandActionKind } from './band-policy';
import { deriveBandState, type BandState } from './band-state';
import { toLanePrState } from './lane-band-input';

export interface BandModel {
  state: BandState;
  primary: BandAction | null;
  menu: BandAction[];
  /** Every action the band can run, in ladder order — the menu's stable shape. */
  ladder: BandAction[];
  prNumber: number | null;
  prUrl: string | null;
  changedCount: number;
  failingCheckCount: number;
  /** The worktree's status has been read at least once — until then "dirty" is unknown. */
  ready: boolean;
  focusedArtifact: ArtifactRow | null;
  busy: boolean;
  error: string | null;
  commitMessage: string;
  setCommitMessage: (message: string) => void;
  commitGeneration: ReturnType<typeof useGitAiGeneration> & {
    /** The agent Settings › Git › AI names for this repository; null while loading. */
    agent: GitAiAgent | null;
  };
  run: (kind: BandActionKind, strategy?: MergeStrategy) => Promise<void>;
}

/**
 * Everything the status band needs, in one place.
 *
 * The reads are the same react-query keys the panels already use, so the band
 * costs no extra polling — it joins the cache entries rather than opening its
 * own. What is genuinely new here is the joining itself: the band is the first
 * surface that has to know about the worktree, the pull request and the
 * focused artifact at once, because it offers one button for all three.
 *
 * The pull request is the focused lane's (plan 2026-09-26 P8): Create PR,
 * checks, reviews and Merge all follow the lane the user has open, so a second
 * lane opens its own PR while the primary's is still open.
 */
export function useBandModel(workItem: WorkItemRow): BandModel {
  const { workItemId, worktreeId, layoutKey } = useRailScope();
  const queryClient = useQueryClient();

  const worktrees = useLiveWorktrees(workItemId);
  const worktree = worktrees.find((row) => row.id === worktreeId) ?? null;
  const projectId = useWorktreeProject(worktreeId).data;
  const { status, isPending: statusPending } = useWorktreeStatus(projectId, worktreeId);
  const log = useWorktreeLog(projectId, worktreeId);
  const gitActions = useWorktreeGitActions(projectId, worktreeId, workItemId);
  const runWorkItemGitAction = useGitActions(workItem, worktreeId);
  const lanes = useLanePullRequests(workItemId);
  const prActions = useLanePrActions(workItemId, worktreeId);
  const checks = useLaneChecks(workItemId, worktreeId);
  const reviews = useLaneReviews(workItemId, worktreeId);
  const { handoff, error: handoffError } = useAgentHandoff({ workItemId });

  const [commitMessage, setCommitMessage] = useState('');
  const gitAi = useGitAiSettings(workItem.repoId);
  const generation = useGitAiGeneration(
    (requestId) => {
      if (!worktreeId) throw new Error('This work item has no focused worktree');
      return rpc.gitAi.generateCommitMessage({ workItemId, worktreeId, requestId });
    },
    (generated) => setCommitMessage(generated.message)
  );

  const artifacts = useWorkItemArtifacts(workItemId);
  const layout = useCenterLayout(layoutKey);
  const focusedTab = getFocusedPane(layout.layout).active;
  const focusedArtifactId = focusedTab?.kind === 'path' ? focusedTab.artifactId : undefined;
  const focusedArtifact =
    focusedArtifactId !== undefined
      ? ((artifacts.data ?? []).find((artifact) => artifact.id === focusedArtifactId) ?? null)
      : null;

  // Read by git from where Push sends the branch; null until the log lands.
  const publication = log.data?.publication.kind ?? null;
  const changedCount =
    (status?.staged.length ?? 0) + (status?.unstaged.length ?? 0) + (status?.untracked.length ?? 0);
  const checkRows = useMemo(() => checks.data?.checks ?? [], [checks.data]);
  const failingCheckCount = checkRows.filter((check) => check.status === 'fail').length;
  const reviewRows = reviews.data ?? [];
  const reviewState = reviewRows.length > 0 ? computeReviewAggregate(reviewRows).state : null;
  const prState = toLanePrState(prActions.pr);
  // Both PR facts are unknown until the lanes load; `lanesLoaded` makes
  // Create PR wait with its own reason rather than claim there is no remote.
  const lanesLoaded = lanes.data !== undefined;
  const hasGitHubRemote = (lanes.data?.repositoryUrl ?? null) !== null;
  const busy = gitActions.pending || prActions.merging;

  const policy = useMemo(
    () =>
      selectBandAction({
        sourceControl: {
          hasCheckout: !!projectId && !!worktreeId,
          stagedCount: status?.staged.length ?? 0,
          // A new file is committable too: the policy counts it as unstaged.
          unstagedCount: (status?.unstaged.length ?? 0) + (status?.untracked.length ?? 0),
          conflictCount: status?.conflicts.length ?? 0,
          aheadCount: log.data?.aheadCount ?? 0,
          publication,
          branchName: status?.currentBranch ?? worktree?.branchName ?? null,
          hasPullRequest: prActions.pr !== null,
          hasGitHubRemote,
          lanesLoaded,
          commitMessage,
          busy,
        },
        canMerge: prActions.canMerge,
        prState,
        workItemDone: workItem.status === 'done',
        focusedArtifactStatus: toArtifactStatus(focusedArtifact?.status),
      }),
    [
      projectId,
      worktreeId,
      status,
      log.data,
      publication,
      worktree,
      prActions.pr,
      hasGitHubRemote,
      lanesLoaded,
      workItem.status,
      commitMessage,
      busy,
      prActions.canMerge,
      prState,
      focusedArtifact,
    ]
  );

  const state = useMemo(
    () =>
      deriveBandState({
        conflictCount: status?.conflicts.length ?? 0,
        changedCount,
        aheadCount: log.data?.aheadCount ?? 0,
        publication,
        prState,
        failingCheckCount,
        runningCheckCount: checkRows.filter((check) => check.status === 'pending').length,
        reviewState,
        canMerge: prActions.canMerge,
      }),
    [
      status,
      changedCount,
      log.data,
      publication,
      prState,
      failingCheckCount,
      checkRows,
      reviewState,
      prActions.canMerge,
    ]
  );

  const run = useCallback(
    async (kind: BandActionKind, strategy?: MergeStrategy) => {
      switch (kind) {
        case 'create-pr':
          await runWorkItemGitAction('create-pr');
          return;
        case 'resolve-conflicts':
          await handoff({
            subject: 'Resolve merge conflicts',
            detail: `These files are conflicted in ${worktree?.branchName ?? 'this worktree'}:\n\n${(
              status?.conflicts ?? []
            )
              .map((change) => change.path)
              .join('\n')}`,
            instruction:
              'Resolve each conflict, keeping both sides where they are compatible, and stage the resolved files.',
          });
          return;
        case 'commit': {
          // Chord commits the whole worktree, as every other commit surface
          // does; staging first is what makes "Commit" mean the same thing
          // here and in the palette.
          if ((status?.staged.length ?? 0) === 0) await gitActions.runAsync({ kind: 'stage-all' });
          await gitActions.runAsync({ kind: 'commit', message: commitMessage.trim() });
          setCommitMessage('');
          return;
        }
        case 'publish': {
          const branchName = status?.currentBranch ?? worktree?.branchName;
          if (!branchName) return;
          await gitActions.runAsync({ kind: 'publish', branchName });
          return;
        }
        case 'push':
        case 'pull':
          await gitActions.runAsync({ kind });
          return;
        case 'merge':
          await prActions.merge(strategy ?? 'merge');
          return;
        case 'mark-done':
          await rpc.workItems.update({ id: workItemId, status: 'done' });
          await queryClient.invalidateQueries({ queryKey: ['workItems'] });
          return;
        case 'approve': {
          if (!focusedArtifact) return;
          await rpc.artifacts.updateStatus({ id: focusedArtifact.id, status: 'approved' });
          await invalidateWorkItemArtifacts(queryClient, workItemId);
          return;
        }
        case 'ask-agent-to-build': {
          if (!focusedArtifact) return;
          await handoff({
            subject: `Build "${focusedArtifact.name}"`,
            detail: `The artifact \`${focusedArtifact.name}\` describes what to build. It is at \`${focusedArtifact.filePath || focusedArtifact.name}\`.`,
            instruction: 'Implement it in this worktree and say what you changed.',
          });
          return;
        }
      }
    },
    [
      runWorkItemGitAction,
      handoff,
      worktree,
      status,
      gitActions,
      commitMessage,
      prActions,
      workItemId,
      queryClient,
      focusedArtifact,
    ]
  );

  return {
    state,
    primary: policy.primary,
    menu: policy.menu,
    ladder: policy.primary ? [policy.primary, ...policy.menu] : policy.menu,
    prNumber: prActions.pr?.number ?? null,
    prUrl: prActions.prUrl,
    changedCount,
    failingCheckCount,
    ready: !!worktreeId && !statusPending,
    focusedArtifact,
    busy,
    // A failed commit read leaves the publication unknown; say why rather
    // than show "Checking the branch…" forever.
    error: gitActions.error ?? prActions.error ?? handoffError ?? log.error?.message ?? null,
    commitMessage,
    setCommitMessage,
    commitGeneration: { ...generation, agent: gitAi.data?.value.agent ?? null },
    run,
  };
}

/**
 * `artifacts.status` is a text column, so the row's type is `string`. Only the
 * four values the artifact editor writes mean anything to the band; anything
 * else is treated as no focused artifact rather than silently approved.
 */
function toArtifactStatus(status: string | undefined): ArtifactStatus | null {
  const known: ArtifactStatus[] = ['draft', 'in_review', 'approved', 'built'];
  return known.find((value) => value === status) ?? null;
}
