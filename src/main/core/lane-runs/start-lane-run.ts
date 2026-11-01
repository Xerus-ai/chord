import { existsSync } from 'node:fs';
import type {
  LaneRunHost,
  LaneTestState,
  RunScriptState,
  StartLaneRunError,
} from '@shared/lane-runs';
import { makePtySessionId } from '@shared/ptySessionId';
import { err, ok, type Result } from '@shared/result';
import type { AskScriptApproval } from '@main/core/workspaces/ask-script-approval';
import { buildLaneEnv } from '@main/core/worktrees/lane-env';
import { findWorktreeRow } from '@main/core/worktrees/worktree-lookup';
import { spawnLaneProcess } from './lane-process';
import {
  claimLaneProcessStart,
  isLaneProcessStartClaimed,
  readLaneRunState,
  releaseLaneProcessStart,
  runProcessKey,
  setRunScriptUrl,
  stopLaneRun,
  TEST_PROCESS_KEY,
  trackLaneTest,
  trackRunScript,
} from './lane-run-registry';
import { approveLaneScript, findLaneScript, type LaneScriptChoice } from './resolve-lane-script';

/**
 * Start, Restart and Run tests. Each runs one script of the lane — in its
 * checkout, or in `host.cwd` (Solo runs a lane's scripts in the repository's
 * root checkout) — with the lane env plus `host.extraEnv`. The state is the
 * lane's either way.
 */

export interface StartLaneRunArgs {
  laneId: string;
  scriptId: string;
  host?: LaneRunHost;
}

export interface RunLaneTestArgs {
  laneId: string;
  host?: LaneRunHost;
}

/** The PTY session of a lane's run script, or of its test (`choice`). */
function laneSessionId(laneId: string, choice: LaneScriptChoice): string {
  return makePtySessionId(
    'lane-run',
    laneId,
    choice.kind === 'run' ? `run.${choice.scriptId}` : 'test'
  );
}

async function startLaneProcess(
  laneId: string,
  choice: LaneScriptChoice,
  host: LaneRunHost | undefined,
  ask: AskScriptApproval
): Promise<Result<void, StartLaneRunError>> {
  const row = findWorktreeRow(laneId);
  if (!row) return err({ type: 'not_found' as const });
  const key = choice.kind === 'run' ? runProcessKey(choice.scriptId) : TEST_PROCESS_KEY;
  if (!claimLaneProcessStart(laneId, key)) return err({ type: 'already_running' as const });
  try {
    // What the lane runs is read from its checkout (its Claude config is part of it).
    if (!existsSync(row.path)) return err({ type: 'checkout_missing' as const });
    // Then what was asked for: an unknown script is no_script in any lane state.
    const found = await findLaneScript(laneId, choice);
    if (!found.success) return found;
    // A Solo-mode app runs once, from the root: only the Solo layer (which
    // passes the root as the host) starts its run scripts. Tests stay per lane.
    if (choice.kind === 'run' && !host && found.data.lane.config.runMode.value === 'solo') {
      return err({ type: 'solo_mode' as const });
    }
    // Setup installs what the scripts need; starting before it is done fails confusingly.
    if (row.setupStatus === 'pending' || row.setupStatus === 'running') {
      return err({ type: 'setup_running' as const });
    }
    const cwd = host?.cwd ?? row.path;
    if (!existsSync(cwd)) return err({ type: 'checkout_missing' as const });

    const script = await approveLaneScript(found.data, ask);
    if (!script.success) return script;
    const env = { ...(await buildLaneEnv(laneId)), ...host?.extraEnv };
    // Asking the user can take a while: the lane may have gone meanwhile.
    if (!isLaneProcessStartClaimed(laneId, key)) return err({ type: 'not_found' as const });
    const sessionId = laneSessionId(laneId, choice);

    if (choice.kind === 'test') {
      const proc = spawnLaneProcess({
        sessionId,
        cwd,
        commandLine: script.data.command,
        shellSetup: script.data.shellSetup,
        env,
      });
      trackLaneTest(laneId, proc);
      return ok();
    }
    const { scriptId } = choice;
    const proc = spawnLaneProcess({
      sessionId,
      cwd,
      commandLine: script.data.command,
      shellSetup: script.data.shellSetup,
      env,
      watchUrl: {
        scopeId: laneId,
        terminalId: `run.${scriptId}`,
        onUrlChange: (url) => setRunScriptUrl(laneId, scriptId, proc, url),
      },
    });
    trackRunScript(laneId, scriptId, proc);
    return ok();
  } finally {
    releaseLaneProcessStart(laneId, key);
  }
}

export async function startLaneRun(
  args: StartLaneRunArgs,
  ask: AskScriptApproval
): Promise<Result<RunScriptState, StartLaneRunError>> {
  const started = await startLaneProcess(
    args.laneId,
    { kind: 'run', scriptId: args.scriptId },
    args.host,
    ask
  );
  if (!started.success) return started;
  return ok(readLaneRunState(args.laneId).scripts[args.scriptId]);
}

/** Stop (Ctrl+C, then the tree kill after the grace period), then Start. */
export async function restartLaneRun(
  args: StartLaneRunArgs,
  ask: AskScriptApproval
): Promise<Result<RunScriptState, StartLaneRunError>> {
  // Refused before the stop: a Restart that cannot start must not stop either.
  const row = findWorktreeRow(args.laneId);
  if (!args.host && row && existsSync(row.path)) {
    const found = await findLaneScript(args.laneId, { kind: 'run', scriptId: args.scriptId });
    if (found.success && found.data.lane.config.runMode.value === 'solo') {
      return err({ type: 'solo_mode' as const });
    }
  }
  await stopLaneRun(args.laneId, args.scriptId);
  return startLaneRun(args, ask);
}

export async function runLaneTest(
  args: RunLaneTestArgs,
  ask: AskScriptApproval
): Promise<Result<LaneTestState, StartLaneRunError>> {
  const started = await startLaneProcess(args.laneId, { kind: 'test' }, args.host, ask);
  if (!started.success) return started;
  return ok(readLaneRunState(args.laneId).test);
}
