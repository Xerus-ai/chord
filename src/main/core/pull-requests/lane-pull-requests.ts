import { and, eq, isNull } from 'drizzle-orm';
import {
  splitRemoteRef,
  type LanePullRequest,
  type WorkItemLanePullRequests,
} from '@shared/lane-pull-requests';
import { resolveDefaultBaseRef } from '@main/core/repo-config/resolve-lane-base';
import { deriveChecksState } from '@main/core/work-items/checks-passing';
import { readPullRequestData } from '@main/core/work-items/sidebar-pr-reads';
import { db } from '@main/db/client';
import { workItems, workItemWorktrees, type WorkItemWorktreeRow } from '@main/db/schema-work-items';
import { readCheckoutRemotes } from './checkout-remotes';
import {
  findPullRequestsForBranches,
  readPullRequestNumber,
  type BranchPullRequestRow,
} from './pr-branch-match';

/**
 * PR per lane, derived (plan 2026-09-26 P8): each lane's PR is the synced PR
 * whose head is the lane's branch in the checkout's GitHub repository. The
 * remote is read from the work item's checkout (`repo_path`, the primary's):
 * every lane is a worktree of the same clone, so they share its remotes.
 */

async function loadWorkItem(workItemId: string) {
  const [item] = await db.select().from(workItems).where(eq(workItems.id, workItemId)).limit(1);
  return item ?? null;
}

/** Live lanes, primary first, then oldest to newest — the order every lane list uses. */
async function readLiveLanes(workItemId: string): Promise<WorkItemWorktreeRow[]> {
  const rows = await db
    .select()
    .from(workItemWorktrees)
    .where(and(eq(workItemWorktrees.workItemId, workItemId), isNull(workItemWorktrees.archivedAt)));
  return rows.sort((a, b) => b.isPrimary - a.isPrimary || a.createdAt - b.createdAt);
}

/**
 * Where each lane's PR merges. A lane from before `target_ref` was recorded
 * merges into the repository's default as this clone knows it now
 * (`resolveDefaultBaseRef`, no fetch) — read once, only when a lane needs it.
 */
async function resolveLaneTargets(
  repoPath: string,
  lanes: WorkItemWorktreeRow[],
  remoteNames: string[]
): Promise<Map<string, Pick<LanePullRequest, 'targetRef' | 'prBase' | 'targetError'>>> {
  let repositoryDefault: Awaited<ReturnType<typeof resolveDefaultBaseRef>> | null = null;
  const targets = new Map<string, Pick<LanePullRequest, 'targetRef' | 'prBase' | 'targetError'>>();
  for (const lane of lanes) {
    let targetRef = lane.targetRef;
    if (targetRef === null) {
      repositoryDefault ??= await resolveDefaultBaseRef(repoPath);
      if (!repositoryDefault.success) {
        targets.set(lane.id, {
          targetRef: null,
          prBase: null,
          targetError: repositoryDefault.error.message,
        });
        continue;
      }
      targetRef = repositoryDefault.data;
    }
    // A target no remote prefixes is a local branch: GitHub names it the same.
    const prBase = splitRemoteRef(targetRef, remoteNames)?.branch ?? targetRef;
    targets.set(lane.id, { targetRef, prBase, targetError: null });
  }
  return targets;
}

/** Every live lane of the work item with its PR; null for a work item that does not exist. */
export async function readLanePullRequests(
  workItemId: string
): Promise<WorkItemLanePullRequests | null> {
  const item = await loadWorkItem(workItemId);
  if (!item) return null;

  const lanes = await readLiveLanes(workItemId);
  const remotes = await readCheckoutRemotes(item.repoPath);
  const targets = await resolveLaneTargets(item.repoPath, lanes, remotes.names);
  const branches = lanes.map((lane) => lane.branchName).filter((b): b is string => b !== null);
  const prsByBranch = remotes.repositoryUrl
    ? await findPullRequestsForBranches(remotes.repositoryUrl, branches)
    : new Map<string, BranchPullRequestRow>();
  const { checksByUrl } = await readPullRequestData([...prsByBranch.values()].map((pr) => pr.url));

  return {
    repositoryUrl: remotes.repositoryUrl,
    lanes: lanes.map((lane) => {
      const target = targets.get(lane.id);
      if (!target) throw new Error(`No target resolved for lane ${lane.id}`);
      const pr = lane.branchName === null ? undefined : prsByBranch.get(lane.branchName);
      return {
        worktreeId: lane.id,
        branchName: lane.branchName,
        isPrimary: lane.isPrimary === 1,
        ...target,
        pr: pr
          ? {
              number: readPullRequestNumber(pr),
              url: pr.url,
              title: pr.title,
              status: pr.status,
              isDraft: !!pr.isDraft,
              headRefName: pr.headRefName,
              baseRefName: pr.baseRefName,
              headRefOid: pr.headRefOid,
              mergeableStatus: pr.mergeableStatus,
              reviewDecision: pr.reviewDecision,
              checks: deriveChecksState(checksByUrl.get(pr.url) ?? [], pr.headRefOid),
            }
          : null,
      };
    }),
  };
}

/**
 * One lane's PR — `worktreeId` omitted means the primary. Null when the work
 * item does not exist, or the lane has no PR. A lane that is not a live lane
 * of this work item is an error: an id from a closed tab or another item must
 * never read some other lane's PR.
 */
export async function readLanePr(
  workItemId: string,
  worktreeId?: string
): Promise<{ number: number; url: string; headRefOid: string } | null> {
  const item = await loadWorkItem(workItemId);
  if (!item) return null;
  const lanes = await readLiveLanes(workItemId);
  const lane =
    worktreeId === undefined
      ? lanes.find((row) => row.isPrimary === 1)
      : lanes.find((row) => row.id === worktreeId);
  if (!lane) {
    throw new Error(
      worktreeId === undefined
        ? `Work item ${workItemId} has no primary lane`
        : `Worktree ${worktreeId} is not a live lane of work item ${workItemId}`
    );
  }
  if (lane.branchName === null) return null;
  const { repositoryUrl } = await readCheckoutRemotes(item.repoPath);
  if (!repositoryUrl) return null;
  const pr = (await findPullRequestsForBranches(repositoryUrl, [lane.branchName])).get(
    lane.branchName
  );
  return pr ? { number: readPullRequestNumber(pr), url: pr.url, headRefOid: pr.headRefOid } : null;
}
