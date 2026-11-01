import type { LaneSetupStatus } from './events/workItemEvents';
import type { RunMode } from './run-scripts';

/**
 * A lane's processes as the Run tab sees them (plan 2026-09-26 §"Decisions
 * for Phase 4", Processes and Run tab). Runtime state only, held by the main
 * process: nothing here is stored, and none of it survives a restart.
 */

export type RunScriptStatus = 'stopped' | 'running' | 'stopping' | 'exited';

export interface RunScriptState {
  status: RunScriptStatus;
  /** The process's exit code; null while it runs, or when it never ran. */
  exitCode: number | null;
  /** Epoch ms. */
  startedAt: number | null;
  /** The dev server URL the script printed, while it is reachable. */
  url: string | null;
  /** The PTY session holding its terminal (kept after exit, so the log stays readable). */
  ptySessionId: string | null;
}

/** `stopped`: the user ended the run, which says nothing about whether the tests pass. */
export type LaneTestStatus = 'idle' | 'running' | 'passed' | 'failed' | 'stopped';

export interface LaneTestState {
  status: LaneTestStatus;
  exitCode: number | null;
  /** Epoch ms. */
  startedAt: number | null;
  /** Epoch ms. */
  finishedAt: number | null;
  durationMs: number | null;
  ptySessionId: string | null;
}

export interface LaneRunState {
  laneId: string;
  /** By run script id; a script that never ran has no entry. */
  scripts: Record<string, RunScriptState>;
  test: LaneTestState;
}

/**
 * Where a lane's scripts run when not in its own checkout: the repository's
 * root checkout for Solo, with the env that says so. The run state stays the
 * lane's.
 */
export interface LaneRunHost {
  cwd: string;
  /** Laid over the lane env (`buildLaneEnv`). */
  extraEnv: Record<string, string>;
}

export type StartLaneRunError =
  | { type: 'not_found' }
  | { type: 'no_script' }
  | { type: 'declined' }
  | { type: 'already_running' }
  | { type: 'setup_running' }
  | { type: 'checkout_missing' }
  | { type: 'config_invalid'; message: string }
  /** The repository runs in Solo mode: its run scripts start in the root, through Solo only. */
  | { type: 'solo_mode' };

export interface LaneRunScript {
  id: string;
  title: string;
}

/** What the Run tab reads for one lane (`laneRuns.get`). */
export interface LaneRunView {
  laneId: string;
  repoId: string | null;
  /** The repository's run scripts, from its config, whether or not they ever ran. */
  scripts: LaneRunScript[];
  hasTest: boolean;
  /** Null while the repository's `.chord.json` cannot be read (`configError`). */
  runMode: RunMode | null;
  configError: string | null;
  setupStatus: LaneSetupStatus | null;
  /** The lane's port block: CHORD_PORT is `base`. */
  ports: { base: number; size: number };
  runs: LaneRunState;
}
