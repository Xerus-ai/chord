import { describeRunScriptEnd, describeTestEnd } from '@shared/lane-process-end';
import type {
  LaneRunScript,
  LaneRunState,
  LaneTestState,
  RunScriptState,
  StartLaneRunError,
} from '@shared/lane-runs';
import type { StatusSignal } from '@renderer/lib/status-dot';

/**
 * What the Run tab says about a lane's processes (plan §Phase 4, Run tab):
 * each row's status line and the actions it allows, the test's last result,
 * the port block, and the dot on the tab.
 */

export interface RunScriptRowModel {
  label: string;
  signal: StatusSignal;
  url: string | null;
  canStart: boolean;
  canStop: boolean;
  canRestart: boolean;
}

/** A script with no state never ran in this run of the app: Stopped. */
export function describeRunScriptRow(state: RunScriptState | undefined): RunScriptRowModel {
  const idle = { url: null, canStart: true, canStop: false, canRestart: false };
  if (!state || state.status === 'stopped') {
    return { label: describeRunScriptEnd('stopped', null), signal: 'neutral', ...idle };
  }
  switch (state.status) {
    case 'running':
      return {
        label: state.url ? `Running · ${state.url}` : 'Running',
        signal: 'success',
        url: state.url,
        canStart: false,
        canStop: true,
        canRestart: true,
      };
    case 'stopping':
      return { label: 'Stopping…', signal: 'running', ...idle, canStart: false };
    case 'exited':
      return {
        label: describeRunScriptEnd('exited', state.exitCode),
        signal: state.exitCode !== null && state.exitCode !== 0 ? 'danger' : 'neutral',
        ...idle,
      };
  }
}

export interface TestResultModel {
  label: string;
  signal: StatusSignal;
  duration: string | null;
  finishedAt: number | null;
  canRun: boolean;
  canStop: boolean;
}

export function describeTestResult(test: LaneTestState): TestResultModel {
  const finished = {
    duration: test.durationMs === null ? null : formatRunDuration(test.durationMs),
    finishedAt: test.finishedAt,
    canRun: true,
    canStop: false,
  };
  switch (test.status) {
    case 'idle':
      return { label: 'Not run yet', signal: 'neutral', ...finished };
    case 'running':
      return {
        label: 'Running…',
        signal: 'running',
        duration: null,
        finishedAt: null,
        canRun: false,
        canStop: true,
      };
    case 'passed':
      return { label: describeTestEnd('passed', test.exitCode), signal: 'success', ...finished };
    case 'failed':
      return { label: describeTestEnd('failed', test.exitCode), signal: 'danger', ...finished };
    case 'stopped':
      return { label: describeTestEnd('stopped', test.exitCode), signal: 'neutral', ...finished };
  }
}

/** "0.4s" under a minute, "2m 5s" from one. */
export function formatRunDuration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function formatPortBlock(ports: { base: number; size: number }): string {
  return `Ports ${ports.base}–${ports.base + ports.size - 1} · CHORD_PORT=${ports.base}`;
}

/**
 * The dot on the Run tab: an error when the last test failed — it outranks
 * a running script, as a failing check does on Checks — ok while anything
 * runs, nothing otherwise. A test run the user stopped is not a failure.
 */
export function deriveRunTabSignal(runs: LaneRunState | undefined): StatusSignal {
  if (!runs) return 'neutral';
  if (runs.test.status === 'failed') return 'danger';
  const scriptRuns = Object.values(runs.scripts).some(
    (state) => state.status === 'running' || state.status === 'stopping'
  );
  if (scriptRuns || runs.test.status === 'running') return 'success';
  return 'neutral';
}

/** A Start / Run tests refusal, in the words the row shows. */
export function describeStartError(error: StartLaneRunError | { type: 'solo_not_held' }): string {
  switch (error.type) {
    case 'setup_running':
      return 'Setup is still running, so dependencies may be missing. Start again once it finishes.';
    case 'declined':
      return "You chose Don't run, so nothing ran. Start again to review the script.";
    case 'no_script':
      return 'The repository no longer has this script.';
    case 'already_running':
      return 'It is already running.';
    case 'checkout_missing':
      return "This lane's checkout is not on this machine.";
    case 'not_found':
      return 'This lane no longer exists.';
    case 'config_invalid':
      return error.message;
    case 'solo_not_held':
      return 'This branch no longer holds Solo, so nothing ran in the root.';
    case 'solo_mode':
      return 'This repository runs in Solo mode: its run scripts start in the root, with Solo this branch.';
  }
}

/** The repository declares neither a run script nor a test script. */
export function isRunTabEmpty(view: { scripts: LaneRunScript[]; hasTest: boolean }): boolean {
  return view.scripts.length === 0 && !view.hasTest;
}
