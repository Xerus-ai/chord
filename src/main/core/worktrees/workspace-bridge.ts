import { eq } from 'drizzle-orm';
import { releaseLaneRuns } from '@main/core/lane-runs/lane-run-registry';
import { repoIsOnDisk } from '@main/core/work-items/repo-on-disk';
import { askScriptApproval } from '@main/core/workspaces/ask-script-approval';
import type { Workspace } from '@main/core/workspaces/workspace';
import { createWorkspaceFactory } from '@main/core/workspaces/workspace-factory';
import { workspaceRegistry } from '@main/core/workspaces/workspace-registry';
import { db } from '@main/db/client';
import { workItems, workItemWorktrees, type WorkItemWorktreeRow } from '@main/db/schema-work-items';
import { log } from '@main/lib/logger';
import { selectBootWorktrees } from './boot-selection';
import { resolveLaneBundle } from './lane-bundle';
import { isAdoptedLane, resolveApprovedLaneScripts, resolveLaneRuntimeConfig } from './lane-config';
import { buildLaneEnv } from './lane-env';
import { approveBundleForLane } from './lane-run-approval';
import { repoFetchRegistry } from './repo-fetch-registry-instance';
import { resolveMainRepoPathForWorkItem } from './repo-path';

export interface BootAcquisitionSummary {
  acquired: number;
  skipped: number;
  failed: number;
}

/**
 * The `projectId` (repo fetch-service key) each currently-held worktree
 * workspace was acquired under. Recorded at acquire time and consumed at
 * release time so release never needs to re-derive it from the database and
 * a `git rev-parse` — for a legacy work item with no `repos` row, that derivation
 * shells out to git against the worktree's own checkout, which release runs
 * concurrently with removing (`archiveWorktree`, `deleteWorkItem`). Re-deriving
 * there would both do needless work and, if the checkout is already gone,
 * leak the fetch-service refcount with no way to retry.
 */
const projectIdByWorktreeId = new Map<string, string>();

const acquiringByWorktreeId = new Map<string, Promise<Workspace>>();

/**
 * Acquires the workspace registry entry a worktree's `git.*`/`fs.*`/`repository.*`
 * RPC calls are served from (`resolveWorkspace` in `projects/utils.ts` is a
 * plain `workspaceRegistry.get(workspaceId)`, keyed by worktree id).
 *
 * The bridge owns exactly one registry ref per worktree: if one is already
 * held (another caller raced this one, or boot already acquired it), this
 * returns it as-is rather than calling `workspaceRegistry.acquire` again,
 * which would bump the refcount and require a second matching release.
 */
export async function acquireWorktreeWorkspace(row: WorkItemWorktreeRow): Promise<Workspace> {
  const existing = workspaceRegistry.get(row.id);
  if (existing) return existing;

  // Boot acquisition and a create path can reach the same worktree at once;
  // both would pass the `get` check above and take a second registry ref and
  // fetch-service ref that no release ever gives back. Share the pending one.
  const pending = acquiringByWorktreeId.get(row.id);
  if (pending) return pending;

  const acquisition = acquireWorktreeWorkspaceOnce(row).finally(() => {
    acquiringByWorktreeId.delete(row.id);
  });
  acquiringByWorktreeId.set(row.id, acquisition);
  return acquisition;
}

async function acquireWorktreeWorkspaceOnce(row: WorkItemWorktreeRow): Promise<Workspace> {
  const [workItem] = await db
    .select()
    .from(workItems)
    .where(eq(workItems.id, row.workItemId))
    .limit(1);
  if (!workItem) {
    throw new Error(`Worktree ${row.id} references missing work item ${row.workItemId}`);
  }
  const mainRepoPath = await resolveMainRepoPathForWorkItem(workItem, row);
  const projectId = workItem.repoId ?? mainRepoPath;
  // `.chord.json` at the lane's target ref — never the checkout's own copy,
  // which the agent working in it can edit. Only what executes nothing is
  // read here; scripts are resolved, approval-checked, when they run.
  const config = await resolveLaneRuntimeConfig(row);
  const laneEnv = await buildLaneEnv(row.id);
  const targetBranch = laneEnv.CHORD_DEFAULT_BRANCH;

  // Fetching is per-repository, not per-worktree — see repo-fetch-registry.ts.
  // Acquired before the workspace so the factory never creates its own.
  const fetchService = repoFetchRegistry.acquire(projectId, mainRepoPath);

  try {
    const workspace = await workspaceRegistry.acquire(
      row.id,
      projectId,
      createWorkspaceFactory(
        row.id,
        { kind: 'local' },
        {
          workDir: row.path,
          projectId,
          settings: {
            getRemote: async () => config.remote ?? 'origin',
            getDefaultBranch: async () => targetBranch,
          },
          laneEnv,
          resolveScripts: () => resolveApprovedLaneScripts(row.id),
          tmux: config.tmux,
          logPrefix: '[worktrees]',
          fetchService,
        }
      )
    );
    projectIdByWorktreeId.set(row.id, projectId);
    return workspace;
  } catch (error) {
    repoFetchRegistry.release(projectId);
    throw error;
  }
}

/**
 * Asks, before a lane goes, about a teardown script the user has not
 * approved; the workspace's teardown then runs it only if approved now.
 * Best effort, like teardown itself: removing the lane is what the user
 * asked for, so a failure here is logged and removal goes on.
 */
async function askAboutUnapprovedTeardown(worktreeId: string): Promise<void> {
  try {
    // No teardown runs in an adopted checkout, so there is nothing to ask about.
    if (isAdoptedLane(worktreeId)) return;
    const lane = await resolveLaneBundle(worktreeId);
    if (!lane.bundle?.content.chord.teardown) return;
    await approveBundleForLane(
      {
        laneId: worktreeId,
        repoId: lane.repoId,
        repoPath: lane.sourcePath,
        ref: lane.targetRef,
        remoteUrl: lane.remoteUrl,
        bundle: lane.bundle,
      },
      askScriptApproval
    );
  } catch (error) {
    log.warn(
      '[worktrees] could not ask about the teardown script; it runs only if already approved',
      {
        worktreeId,
        error: String(error),
      }
    );
  }
}

/**
 * Releases the workspace registry entry a worktree was using, and its share
 * of the repo's fetch service. A no-op if nothing is currently held for this
 * worktree (already released, or never acquired).
 *
 * First, whether or not a workspace is held, the lane's run scripts and test
 * are stopped (awaited): every path that removes or re-points a checkout
 * comes through here, and a checkout is never removed under a running
 * process — nor a teardown run beside one.
 */
export async function releaseWorktreeWorkspace(worktreeId: string): Promise<void> {
  await releaseLaneRuns(worktreeId);
  if (!workspaceRegistry.get(worktreeId)) return;

  await askAboutUnapprovedTeardown(worktreeId);
  await workspaceRegistry.release(worktreeId, 'terminate');

  const projectId = projectIdByWorktreeId.get(worktreeId);
  projectIdByWorktreeId.delete(worktreeId);
  if (!projectId) {
    log.warn(
      '[worktrees] released a workspace with no recorded projectId; fetch-service refcount unchanged',
      {
        worktreeId,
      }
    );
    return;
  }
  repoFetchRegistry.release(projectId);
}

/**
 * Acquires a workspace for every non-archived worktree of every active work
 * item, on app boot. Setup never runs from here: it is lane state
 * (`lane-setup.ts`), run once after a checkout is created and on Retry.
 *
 * Per-row isolation, deliberately following the warn-and-continue precedent
 * in `deleteWorkItem`: the dev DB alone has work items pointing at deleted
 * temp e2e repos and at a home-directory path that is not a repo at all. One
 * stale row must not take down every other item's Explorer or Source
 * Control, so a row with no `.git` is skipped, and any other failure is
 * logged and the loop continues.
 */
export async function acquireActiveWorktreeWorkspaces(): Promise<BootAcquisitionSummary> {
  const rows = await db
    .select({
      worktree: workItemWorktrees,
      workItemStatus: workItems.status,
      provisionStatus: workItems.provisionStatus,
    })
    .from(workItemWorktrees)
    .innerJoin(workItems, eq(workItemWorktrees.workItemId, workItems.id));

  const eligible = selectBootWorktrees(
    rows.map((r) => ({
      worktreeId: r.worktree.id,
      workItemId: r.worktree.workItemId,
      path: r.worktree.path,
      archivedAt: r.worktree.archivedAt,
      workItemStatus: r.workItemStatus,
      provisionStatus: r.provisionStatus,
      row: r.worktree,
    }))
  );

  const summary: BootAcquisitionSummary = { acquired: 0, skipped: 0, failed: 0 };

  for (const candidate of eligible) {
    try {
      if (!(await repoIsOnDisk(candidate.path))) {
        log.warn('[worktrees] skipping boot acquisition: no .git at worktree path', {
          worktreeId: candidate.worktreeId,
          path: candidate.path,
        });
        summary.skipped += 1;
        continue;
      }

      await acquireWorktreeWorkspace(candidate.row);
      summary.acquired += 1;
    } catch (error) {
      log.warn('[worktrees] failed to acquire workspace at boot; continuing with other worktrees', {
        worktreeId: candidate.worktreeId,
        workItemId: candidate.workItemId,
        error: String(error),
      });
      summary.failed += 1;
    }
  }

  log.info('[worktrees] boot acquisition complete', summary);
  return summary;
}
