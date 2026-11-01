import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { PullRequestRef } from '@shared/work-item-ticket';
import { rpc } from '@renderer/lib/ipc';
import { applyBranchHolders, resolvePickTarget, type CreateFromPick } from './create-from-pick';
import {
  resolveCreateTarget,
  type CreateTarget,
  type IssueLookupState,
  type PullRequestLookupState,
} from './create-target';
import { resolveSmartField, toIssueRef, toPullRequestRef } from './smart-resolve';
import { useBranchPicks } from './use-create-from-sources';
import { useDebouncedValue } from './use-debounced-value';

const LOOKUP_DEBOUNCE_MS = 350;

function describeThrown(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type BranchPreview =
  | { status: 'pending' }
  | { status: 'ready'; branchName: string }
  | { status: 'failed'; message: string };

function pickPullRef(pick: CreateFromPick | null): PullRequestRef | null {
  if (pick?.kind !== 'pull_request') return null;
  const { owner, repo, number } = pick.pullRequest;
  return { owner, repo, number };
}

/**
 * The create dialog's target, from a Create from… pick or what is typed now:
 * a ticket or PR is looked up once typing pauses, and until the lookup for
 * exactly the current text has answered the target is `looking_up` — so
 * Create (and Ctrl+Enter) can never send a name the user hasn't seen. A
 * checkout of a branch the repository's listing shows as checked out
 * elsewhere is the `held` refusal.
 */
export function useCreateTarget(args: {
  smartText: string;
  pick: CreateFromPick | null;
  repoId: string | null;
  workItemId: string;
}): { target: CreateTarget | null; branchPreview: BranchPreview | null } {
  const { smartText, pick, repoId, workItemId } = args;
  const resolution = useMemo(() => (pick ? null : resolveSmartField(smartText)), [pick, smartText]);
  const debouncedText = useDebouncedValue(smartText, LOOKUP_DEBOUNCE_MS);
  const settled = pick !== null || debouncedText === smartText;

  const issueRef = resolution ? toIssueRef(resolution) : null;
  const pullRef = pickPullRef(pick) ?? (resolution ? toPullRequestRef(resolution) : null);
  const branchesQuery = useBranchPicks(repoId);
  const branches = branchesQuery.data?.success ? branchesQuery.data.data : [];

  const issueQuery = useQuery({
    queryKey: ['create-work-item', 'issue', issueRef],
    queryFn: () => rpc.issues.getIssue(issueRef!),
    enabled: settled && issueRef !== null,
    staleTime: 60_000,
    retry: false,
  });
  // What a PR checks out depends on the repository's remotes — local git state
  // the refusal tells the user to change ("Add it as a remote"). A lookup is
  // never reused by a later dialog: kept 60s, the refusal outlived the fix.
  const pullQuery = useQuery({
    queryKey: ['create-work-item', 'pull-request', repoId, pullRef],
    queryFn: () => rpc.pullRequests.getPullRequestCheckout({ ...pullRef!, repoId }),
    enabled: settled && pullRef !== null,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

  const issueLookup: IssueLookupState | null =
    !issueRef || !settled || issueQuery.isPending
      ? null
      : issueQuery.isError
        ? { status: 'failed', error: { type: 'error', message: describeThrown(issueQuery.error) } }
        : issueQuery.data.success
          ? { status: 'found', ticket: issueQuery.data.data }
          : { status: 'failed', error: issueQuery.data.error };

  const pullRequestLookup: PullRequestLookupState | null =
    !pullRef || !settled || pullQuery.isPending
      ? null
      : pullQuery.isError
        ? { status: 'failed', error: { type: 'error', message: describeThrown(pullQuery.error) } }
        : pullQuery.data.success
          ? { status: 'found', checkout: pullQuery.data.data }
          : { status: 'failed', error: pullQuery.data.error };

  const target = pick
    ? resolvePickTarget({ pick, pullRequestLookup, branches })
    : applyBranchHolders(
        resolveCreateTarget({ resolution, issueLookup, pullRequestLookup }),
        branches
      );

  // The branch is built in main from the same name and id the request sends.
  const previewName =
    target?.kind === 'new_lane' || target?.kind === 'branch_off' ? target.name : null;
  const debouncedPreviewName = useDebouncedValue(previewName, LOOKUP_DEBOUNCE_MS);
  const branchQuery = useQuery({
    queryKey: ['create-work-item', 'branch', debouncedPreviewName, workItemId],
    queryFn: () => rpc.workItems.previewBranchName({ name: debouncedPreviewName!, workItemId }),
    enabled: debouncedPreviewName !== null && debouncedPreviewName === previewName,
    staleTime: 60_000,
    retry: false,
  });

  const branchPreview: BranchPreview | null =
    previewName === null
      ? null
      : debouncedPreviewName !== previewName || branchQuery.isPending
        ? { status: 'pending' }
        : branchQuery.isError
          ? { status: 'failed', message: describeThrown(branchQuery.error) }
          : branchQuery.data.success
            ? { status: 'ready', branchName: branchQuery.data.data.branchName }
            : { status: 'failed', message: branchQuery.data.error.message };

  return { target, branchPreview };
}
