import { eq } from 'drizzle-orm';
import { expandRunScripts, type RunScriptMap } from '@shared/run-scripts';
import { RepoConfigError } from '@main/core/repo-config/read-team-config';
import { resolveDefaultBaseRef } from '@main/core/repo-config/resolve-lane-base';
import { resolveRepoConfig } from '@main/core/repo-config/resolve-repo-config';
import { isBundleApproved } from '@main/core/workspaces/script-approval';
import { db } from '@main/db/client';
import { workItems, type WorkItemWorktreeRow } from '@main/db/schema-work-items';
import { log } from '@main/lib/logger';
import { resolveLaneBundle } from './lane-bundle';
import { resolveMainRepoPathForWorkItem } from './repo-path';
import { findWorktreeRow } from './worktree-lookup';

/**
 * What a running lane takes from its repository's config (`.chord.json` at
 * the lane's target ref). Two reads, at two moments:
 *   - `resolveLaneRuntimeConfig`, when the lane's workspace is acquired: only
 *     what executes nothing (remote, tmux);
 *   - `resolveApprovedLaneScripts`, each time a script would run: the scripts,
 *     only while the user's approval covers what the lane would run.
 *
 * An invalid file is reported by the lane's setup (which fails with the parse
 * error); here it must not take down the lane's git and file panels, so it
 * only drops the scripts.
 */
export interface LaneRuntimeConfig {
  sourcePath: string;
  repoId: string | null;
  targetRef: string;
  remote: string | null;
  tmux: boolean;
}

export interface ApprovedLaneScripts {
  shellSetup?: string;
  /** By script id; empty when there is nothing to run. */
  run: RunScriptMap;
  test?: string;
  teardown?: string;
}

export async function resolveLaneRuntimeConfig(
  row: WorkItemWorktreeRow
): Promise<LaneRuntimeConfig> {
  const [workItem] = db
    .select()
    .from(workItems)
    .where(eq(workItems.id, row.workItemId))
    .limit(1)
    .all();
  if (!workItem) throw new Error(`Lane ${row.id} references missing work item ${row.workItemId}`);

  const sourcePath = await resolveMainRepoPathForWorkItem(workItem, row);
  let targetRef = row.targetRef;
  if (!targetRef) {
    const resolved = await resolveDefaultBaseRef(sourcePath);
    if (!resolved.success) throw new Error(resolved.error.message);
    targetRef = resolved.data;
  }
  const base = { sourcePath, repoId: workItem.repoId, targetRef };

  try {
    const config = await resolveRepoConfig({
      repoId: workItem.repoId,
      repoPath: sourcePath,
      ref: targetRef,
    });
    return { ...base, remote: config.remote.value, tmux: config.tmux.value };
  } catch (error) {
    if (!(error instanceof RepoConfigError)) throw error;
    log.warn('[lanes] invalid .chord.json; the lane runs no repository scripts', {
      laneId: row.id,
      error: error.message,
    });
    return { ...base, remote: null, tmux: false };
  }
}

/** A lane on a checkout the user adopted, which Chord never changes. */
export function isAdoptedLane(laneId: string): boolean {
  const row = findWorktreeRow(laneId);
  if (!row) throw new Error(`Lane ${laneId} does not exist`);
  return row.checkoutOrigin === 'adopted';
}

/**
 * The lane's scripts: the user's own (just-me) ones always, the team's only
 * while what the lane would run now is approved.
 */
export async function resolveApprovedLaneScripts(laneId: string): Promise<ApprovedLaneScripts> {
  let lane;
  try {
    lane = await resolveLaneBundle(laneId);
  } catch (error) {
    if (!(error instanceof RepoConfigError)) throw error;
    log.warn('[lanes] invalid .chord.json; the lane runs no repository scripts', {
      laneId,
      error: error.message,
    });
    return { run: {} };
  }
  const { bundle, config } = lane;
  const approved =
    bundle !== null &&
    isBundleApproved({
      laneId,
      repoId: lane.repoId,
      bundle,
      remoteUrl: lane.remoteUrl,
    });
  const team = approved ? bundle.content.chord : {};
  const own = (kind: 'test' | 'teardown') =>
    config.scripts[kind].layer === 'justMe' ? (config.scripts[kind].value ?? undefined) : undefined;
  const shellSetup = team.shellSetup;
  // The user's own run scripts replace the team's entirely, not per id.
  const run =
    config.scripts.run.layer === 'justMe' ? config.scripts.run.value : expandRunScripts(team.run);
  const test = own('test') ?? team.test;
  // An adopted checkout is the user's (plan §Phase 3 slice 6): no teardown
  // runs in it, the team's or the user's own.
  const teardown = isAdoptedLane(laneId) ? undefined : (own('teardown') ?? team.teardown);
  return {
    ...(shellSetup ? { shellSetup } : {}),
    run,
    ...(test ? { test } : {}),
    ...(teardown ? { teardown } : {}),
  };
}
