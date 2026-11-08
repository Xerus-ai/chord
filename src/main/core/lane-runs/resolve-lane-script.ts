import type { ConfigLayer } from '@shared/repo-config';
import { err, ok, type Result } from '@shared/result';
import { RepoConfigError } from '@main/core/repo-config/read-team-config';
import type { AskScriptApproval } from '@main/core/workspaces/ask-script-approval';
import { isBundleApproved } from '@main/core/workspaces/script-approval';
import { resolveLaneBundle, type LaneBundle } from '@main/core/worktrees/lane-bundle';
import { approveBundleForLane } from '@main/core/worktrees/lane-run-approval';

/**
 * The command a Start or Run tests runs, read at that moment from
 * `.chord.json` at the lane's target ref (`resolveLaneBundle`). The user's own
 * (just-me) script runs as it is; the team's runs only once approved, and the
 * user is asked when it is not — again after an earlier Don't run, because
 * pressing the button is the user asking to run it.
 */

export type LaneScriptChoice = { kind: 'run'; scriptId: string } | { kind: 'test' };

export type ResolveLaneScriptError =
  | { type: 'no_script' }
  | { type: 'declined' }
  | { type: 'config_invalid'; message: string };

export interface LaneScriptToRun {
  command: string;
  /** The team's shellSetup, only while what the lane runs is approved. */
  shellSetup?: string;
}

/** The script asked for, as the lane's config has it now; nothing is asked or approved. */
export interface LaneScriptFound {
  lane: LaneBundle;
  command: string;
  layer: ConfigLayer;
}

/**
 * Validates what a start asks for before anything about the lane's state:
 * `no_script` for an id the repository does not declare (or no test
 * script), `config_invalid` for a `.chord.json` that cannot be read.
 */
export async function findLaneScript(
  laneId: string,
  choice: LaneScriptChoice
): Promise<
  Result<LaneScriptFound, { type: 'no_script' } | { type: 'config_invalid'; message: string }>
> {
  let lane;
  try {
    lane = await resolveLaneBundle(laneId);
  } catch (error) {
    if (!(error instanceof RepoConfigError)) throw error;
    return err({ type: 'config_invalid' as const, message: error.message });
  }
  const { config } = lane;

  const resolved = choice.kind === 'run' ? config.scripts.run : config.scripts.test;
  const raw =
    choice.kind === 'run'
      ? Object.hasOwn(config.scripts.run.value, choice.scriptId)
        ? config.scripts.run.value[choice.scriptId]
        : undefined
      : config.scripts.test.value;
  const command = raw?.trim();
  if (!command) return err({ type: 'no_script' as const });
  return ok({ lane, command, layer: resolved.layer });
}

export async function resolveLaneScriptToRun(
  laneId: string,
  choice: LaneScriptChoice,
  ask: AskScriptApproval
): Promise<Result<LaneScriptToRun, ResolveLaneScriptError>> {
  const found = await findLaneScript(laneId, choice);
  if (!found.success) return found;
  return approveLaneScript(found.data, ask);
}

/** Asks about an unapproved team script (just-me scripts run as they are). */
export async function approveLaneScript(
  found: LaneScriptFound,
  ask: AskScriptApproval
): Promise<Result<LaneScriptToRun, { type: 'declined' }>> {
  const { lane, command } = found;
  const { bundle } = lane;
  const laneId = lane.row.id;

  if (found.layer !== 'justMe') {
    const approved = await approveBundleForLane(
      {
        laneId,
        repoId: lane.repoId,
        repoPath: lane.sourcePath,
        ref: lane.targetRef,
        remoteUrl: lane.remoteUrl,
        claudeSource: lane.claudeSource,
        bundle,
      },
      ask,
      { afterDecline: 'ask' }
    );
    if (!approved) return err({ type: 'declined' as const });
  }

  const teamApproved =
    bundle !== null &&
    lane.repoId !== null &&
    isBundleApproved({
      laneId,
      repoId: lane.repoId,
      bundle,
      remoteUrl: lane.remoteUrl,
    });
  const shellSetup = teamApproved ? bundle.content.chord.shellSetup : undefined;
  return ok(shellSetup ? { command, shellSetup } : { command });
}
