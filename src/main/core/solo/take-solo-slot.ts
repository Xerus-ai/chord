import { existsSync } from 'node:fs';
import type { LaneRunHost } from '@shared/lane-runs';
import type { ResolvedRepoConfig } from '@shared/repo-config';
import { err, ok, type Result } from '@shared/result';
import type { SoloLaneError, SoloRunStart } from '@shared/solo';
import { startLaneRun } from '@main/core/lane-runs/start-lane-run';
import { RepoConfigError } from '@main/core/repo-config/read-team-config';
import type { AskScriptApproval } from '@main/core/workspaces/ask-script-approval';
import { resolveLaneBundle } from '@main/core/worktrees/lane-bundle';
import { findWorktreeRow } from '@main/core/worktrees/worktree-lookup';
import { acquireSoloHost } from './acquire-solo-host';
import { announceSlot, type SoloSlot } from './solo-slots';

/** Where a Solo lane's scripts run: the root checkout, with the env that says so. */
export function soloRunHost(rootPath: string): LaneRunHost {
  return { cwd: rootPath, extraEnv: { CHORD_SOLO: '1', CHORD_ROOT_PATH: rootPath } };
}

export interface SoloLaneContext {
  repoId: string;
  /** The repository's main checkout. */
  rootPath: string;
  config: ResolvedRepoConfig;
  scriptIds: string[];
}

/**
 * The lane's repository and its config at the lane's target ref, read now:
 * Solo applies only to a repository whose run mode is `solo` and that has
 * run scripts.
 */
export async function resolveSoloLane(
  laneId: string
): Promise<Result<SoloLaneContext, SoloLaneError>> {
  if (!findWorktreeRow(laneId)) return err({ type: 'not_found' as const });
  let lane;
  try {
    lane = await resolveLaneBundle(laneId);
  } catch (error) {
    if (!(error instanceof RepoConfigError)) throw error;
    return err({ type: 'config_invalid' as const, message: error.message });
  }
  if (lane.repoId === null) return err({ type: 'no_repo' as const });
  if (lane.config.runMode.value !== 'solo') return err({ type: 'not_solo_mode' as const });
  const scriptIds = Object.keys(lane.config.scripts.run.value);
  if (scriptIds.length === 0) return err({ type: 'no_script' as const });
  return ok({ repoId: lane.repoId, rootPath: lane.sourcePath, config: lane.config, scriptIds });
}

/**
 * Puts the lane in the free slot's root (`acquireSoloHost`) and starts each
 * of its run scripts there. The caller runs inside the slot (`runInSlot`).
 * Refusals leave the root as it was; a script that does not start is
 * reported in its `SoloRunStart`, and the hold stays (Restart, or Release).
 */
export async function takeSoloSlot(
  slot: SoloSlot,
  laneId: string,
  scriptIds: string[],
  ask: AskScriptApproval
): Promise<Result<SoloRunStart[], SoloLaneError>> {
  const row = findWorktreeRow(laneId);
  if (!row) return err({ type: 'not_found' as const });
  if (row.setupStatus === 'pending' || row.setupStatus === 'running') {
    return err({ type: 'setup_running' as const });
  }
  if (!existsSync(row.path)) return err({ type: 'checkout_missing' as const });

  const acquired = await acquireSoloHost({
    rootPath: slot.rootPath,
    laneId,
    laneCheckoutPath: row.path,
  });
  if (!acquired.success) return acquired;
  slot.holder = { laneId, since: acquired.data.startedAt };
  announceSlot(slot);

  const starts: SoloRunStart[] = [];
  for (const scriptId of scriptIds) {
    const started = await startLaneRun({ laneId, scriptId, host: soloRunHost(slot.rootPath) }, ask);
    starts.push({ scriptId, error: started.success ? null : started.error });
  }
  return ok(starts);
}
