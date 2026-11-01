import { and, eq, isNull } from 'drizzle-orm';
import type { BranchHolder, BranchPick, ListBranchPicksError } from '@shared/create-from';
import { selectPreferredRemote } from '@shared/git-utils';
import { ok, type Result } from '@shared/result';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { listBranchCheckouts } from '@main/core/projects/worktrees/find-branch-checkout';
import { comparablePath } from '@main/core/utils/comparable-path';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { db } from '@main/db/client';
import { workItems, workItemWorktrees } from '@main/db/schema-work-items';
import { planTrackingBranch, type LocalBranchRef } from './plan-tracking-branch';
import { readRepoRow } from './repo-github-repository';

/** Refs can't contain a NUL, so it separates the two fields safely. */
const REF_FORMAT = '--format=%(refname)%00%(upstream)';
const MAX_REF_LIST_BYTES = 32 * 1024 * 1024;

type RemoteBranchRow = { remote: string; branch: string };

async function readRefs(ctx: LocalExecutionContext, remotes: string[]) {
  const { stdout } = await ctx.exec(
    GIT_EXECUTABLE,
    ['for-each-ref', REF_FORMAT, 'refs/heads', 'refs/remotes'],
    { maxBuffer: MAX_REF_LIST_BYTES }
  );
  const locals: LocalBranchRef[] = [];
  const remoteBranches: RemoteBranchRow[] = [];
  // Longest name first, so a remote whose name holds a slash wins over a prefix of it.
  const byLength = [...remotes].sort((a, b) => b.length - a.length);
  for (const line of stdout.split('\n')) {
    const [refname, upstream] = line.trim().split('\0');
    if (!refname) continue;
    if (refname.startsWith('refs/heads/')) {
      locals.push({ name: refname.slice('refs/heads/'.length), upstream: upstream || null });
      continue;
    }
    const rest = refname.slice('refs/remotes/'.length);
    const remote = byLength.find((name) => rest.startsWith(`${name}/`));
    if (!remote) continue;
    const branch = rest.slice(remote.length + 1);
    if (branch === 'HEAD') continue;
    remoteBranches.push({ remote, branch });
  }
  return { locals, remoteBranches };
}

/**
 * Live lanes of this repository's work items, by checkout path. A lane row
 * holds the repository's own path until its checkout lands, and keeps it when
 * provisioning failed: that folder is the main checkout, not the lane's.
 */
async function readLaneHolders(
  repoId: string,
  repoPath: string
): Promise<Map<string, BranchHolder>> {
  const rows = await db
    .select({
      path: workItemWorktrees.path,
      workItemId: workItems.id,
      workItemName: workItems.name,
    })
    .from(workItemWorktrees)
    .innerJoin(workItems, eq(workItems.id, workItemWorktrees.workItemId))
    .where(and(eq(workItems.repoId, repoId), isNull(workItemWorktrees.archivedAt)));
  const root = comparablePath(repoPath);
  const holders = new Map<string, BranchHolder>();
  for (const row of rows) {
    const path = comparablePath(row.path);
    if (path !== root) holders.set(path, { kind: 'work_item', ...row });
  }
  return holders;
}

/**
 * The Branches tab of Create from… (plan §Phase 3 slice 2): every branch the
 * repository can check out, with where it is checked out, if anywhere.
 *   - Local branches, as themselves.
 *   - Every remote's branches no local branch already tracks: the preferred
 *     remote's by their own name, any other's as `<remote>/<branch>`, each
 *     with the local branch a checkout makes to track it
 *     (`plan-tracking-branch.ts`).
 * What this clone knows, without fetching. Registrations left by checkouts
 * deleted outside git are pruned first, as the create preflight does, so the
 * two agree on what is free.
 */
export async function listBranchPicks(
  repoId: string
): Promise<Result<BranchPick[], ListBranchPicksError>> {
  const repo = await readRepoRow(repoId);
  if (!repo.success) return repo;
  const ctx = new LocalExecutionContext({ root: repo.data.path });

  await ctx.exec(GIT_EXECUTABLE, ['worktree', 'prune']);
  const remotes = (await ctx.exec(GIT_EXECUTABLE, ['remote'])).stdout
    .split('\n')
    .map((name) => name.trim())
    .filter(Boolean);
  const [{ locals, remoteBranches }, checkouts, laneHolders] = await Promise.all([
    readRefs(ctx, remotes),
    listBranchCheckouts(ctx),
    readLaneHolders(repoId, repo.data.path),
  ]);
  const preferredRemote =
    remotes.length > 0
      ? selectPreferredRemote(
          undefined,
          remotes.map((name) => ({ name, url: '' }))
        ).name
      : null;

  const holderOf = (branch: string): BranchHolder | null => {
    const checkoutPath = checkouts.get(branch);
    if (!checkoutPath) return null;
    return (
      laneHolders.get(comparablePath(checkoutPath)) ?? { kind: 'checkout', path: checkoutPath }
    );
  };

  const picks: BranchPick[] = locals.map((local) => ({
    name: local.name,
    source: 'local',
    remote: null,
    localBranch: local.name,
    tracking: null,
    holder: holderOf(local.name),
  }));

  const preferredBranches = new Set(
    remoteBranches.filter((row) => row.remote === preferredRemote).map((row) => row.branch)
  );
  for (const row of remoteBranches) {
    const plan = planTrackingBranch({
      remote: row.remote,
      branch: row.branch,
      isPreferredRemote: row.remote === preferredRemote,
      preferredRemoteHasBranch: preferredBranches.has(row.branch),
      locals,
    });
    // A local branch already tracks it: that branch is its row.
    if (plan.alreadyTracked) continue;
    picks.push({
      name:
        row.remote === preferredRemote && plan.localBranch === row.branch
          ? row.branch
          : `${row.remote}/${row.branch}`,
      source: 'remote',
      remote: row.remote,
      localBranch: plan.localBranch,
      tracking: { remote: row.remote, branch: row.branch },
      holder: null,
    });
  }
  return ok(picks);
}
