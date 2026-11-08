import { RepoConfigError } from '@main/core/repo-config/read-team-config';
import type { AskScriptApproval } from '@main/core/workspaces/ask-script-approval';
import {
  readClaudeExecutableConfig,
  type ClaudeExecutableConfig,
} from '@main/core/workspaces/executable-bundle';
import { isBundleApproved } from '@main/core/workspaces/script-approval';
import { resolveLaneBundle } from './lane-bundle';
import { approveBundleForLane } from './lane-run-approval';
import { findWorktreeRow, laneSessionCwd } from './worktree-lookup';

/**
 * What an agent starting in a lane may load from the repository. It asks
 * only about what this start would run — the repository's Claude config for
 * a Claude session, `shellSetup` for a shell where it runs — and only when
 * that is unapproved. A setup script alone is setup's question, not this one.
 */

export interface AgentStartApproval {
  /** The lane's executable bundle is approved (or there is none). */
  approved: boolean;
  /** The repository's Claude config that runs code — for the session's gate. */
  claude: ClaudeExecutableConfig;
  /** Set only when approved and the start runs a shell. */
  shellSetup: string | undefined;
}

export async function resolveAgentStartApproval(
  laneId: string,
  start: { claudeSession: boolean; shell: boolean; platform: NodeJS.Platform },
  ask: AskScriptApproval
): Promise<AgentStartApproval> {
  let lane;
  try {
    lane = await resolveLaneBundle(laneId);
  } catch (error) {
    if (!(error instanceof RepoConfigError)) throw error;
    // Setup reports the invalid file. The Claude config is still there and
    // still unapproved, so the session keeps it off.
    const row = findWorktreeRow(laneId);
    if (!row) throw new Error(`Lane ${laneId} does not exist`);
    return {
      approved: false,
      claude: await readClaudeExecutableConfig(laneSessionCwd(row)),
      shellSetup: undefined,
    };
  }

  const { bundle } = lane;
  if (!bundle) return { approved: true, claude: {}, shellSetup: undefined };
  const { claude, chord } = bundle.content;

  const shellRunsSetup =
    start.shell && start.platform !== 'win32' && chord.shellSetup !== undefined;
  const loadsClaude = start.claudeSession && Object.keys(claude).length > 0;
  const approved =
    shellRunsSetup || loadsClaude
      ? await approveBundleForLane(
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
          // A Claude session respawns on its own (a model change does it), so
          // after Don't run it starts stripped again without a dialog. A
          // terminal only opens when the user opens one: that asks again.
          { afterDecline: loadsClaude ? 'skip' : 'ask' }
        )
      : isBundleApproved({
          laneId,
          repoId: lane.repoId,
          bundle,
          remoteUrl: lane.remoteUrl,
        });

  return {
    approved,
    claude,
    shellSetup: approved && shellRunsSetup ? chord.shellSetup : undefined,
  };
}
