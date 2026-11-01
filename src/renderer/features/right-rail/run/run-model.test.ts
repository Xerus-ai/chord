import { describe, expect, it } from 'vitest';
import type { LaneRunState, LaneTestState, RunScriptState } from '@shared/lane-runs';
import {
  deriveRunTabSignal,
  describeRunScriptRow,
  describeStartError,
  describeTestResult,
  formatPortBlock,
  formatRunDuration,
  isRunTabEmpty,
} from './run-model';

/** What the Run tab says about a lane's processes (plan §Phase 4, Run tab). */

function script(overrides: Partial<RunScriptState>): RunScriptState {
  return {
    status: 'stopped',
    exitCode: null,
    startedAt: null,
    url: null,
    ptySessionId: null,
    ...overrides,
  };
}

function test(overrides: Partial<LaneTestState>): LaneTestState {
  return {
    status: 'idle',
    exitCode: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    ptySessionId: null,
    ...overrides,
  };
}

function runs(scripts: Record<string, RunScriptState>, laneTest = test({})): LaneRunState {
  return { laneId: 'lane-1', scripts, test: laneTest };
}

describe('describeRunScriptRow', () => {
  it('shows a script that never ran as Stopped, ready to start', () => {
    expect(describeRunScriptRow(undefined)).toEqual({
      label: 'Stopped',
      signal: 'neutral',
      url: null,
      canStart: true,
      canStop: false,
      canRestart: false,
    });
  });

  it('shows a running script with its URL once the dev server printed one', () => {
    expect(describeRunScriptRow(script({ status: 'running' }))).toMatchObject({
      label: 'Running',
      signal: 'success',
      canStart: false,
      canStop: true,
      canRestart: true,
    });
    expect(
      describeRunScriptRow(script({ status: 'running', url: 'http://localhost:50010' }))
    ).toMatchObject({ label: 'Running · http://localhost:50010', url: 'http://localhost:50010' });
  });

  it('offers nothing while a script is stopping', () => {
    expect(describeRunScriptRow(script({ status: 'stopping' }))).toMatchObject({
      label: 'Stopping…',
      signal: 'running',
      canStart: false,
      canStop: false,
      canRestart: false,
    });
  });

  it('shows how a script exited on its own; a non-zero code is a failure', () => {
    expect(describeRunScriptRow(script({ status: 'exited', exitCode: 0 }))).toMatchObject({
      label: 'Exited 0',
      signal: 'neutral',
      canStart: true,
    });
    expect(describeRunScriptRow(script({ status: 'exited', exitCode: 2 }))).toMatchObject({
      label: 'Exited 2',
      signal: 'danger',
    });
    expect(describeRunScriptRow(script({ status: 'exited' })).label).toBe('Exited');
  });
});

describe('describeTestResult', () => {
  it('says the tests have not run yet', () => {
    expect(describeTestResult(test({}))).toEqual({
      label: 'Not run yet',
      signal: 'neutral',
      duration: null,
      finishedAt: null,
      canRun: true,
      canStop: false,
    });
  });

  it('offers Stop while the tests run', () => {
    expect(describeTestResult(test({ status: 'running', startedAt: 1 }))).toMatchObject({
      label: 'Running…',
      signal: 'running',
      canRun: false,
      canStop: true,
    });
  });

  it('reports the last result with its duration and when it finished', () => {
    expect(
      describeTestResult(
        test({ status: 'passed', exitCode: 0, durationMs: 3400, finishedAt: 5000 })
      )
    ).toMatchObject({ label: 'Passed', signal: 'success', duration: '3.4s', finishedAt: 5000 });
    expect(
      describeTestResult(test({ status: 'failed', exitCode: 1, durationMs: 400, finishedAt: 9 }))
    ).toMatchObject({ label: 'Failed (exit 1)', signal: 'danger', duration: '0.4s', canRun: true });
    expect(describeTestResult(test({ status: 'failed' })).label).toBe('Failed');
  });

  it('reports a run the user stopped as Stopped, not as a failure', () => {
    expect(
      describeTestResult(test({ status: 'stopped', exitCode: 0, durationMs: 1200, finishedAt: 7 }))
    ).toEqual({
      label: 'Stopped',
      signal: 'neutral',
      duration: '1.2s',
      finishedAt: 7,
      canRun: true,
      canStop: false,
    });
  });
});

describe('formatRunDuration', () => {
  it('uses tenths of a second under a minute, minutes and seconds above', () => {
    expect(formatRunDuration(400)).toBe('0.4s');
    expect(formatRunDuration(3400)).toBe('3.4s');
    expect(formatRunDuration(61_000)).toBe('1m 1s');
    expect(formatRunDuration(125_500)).toBe('2m 5s');
  });
});

describe('formatPortBlock', () => {
  it("names the lane's ports and the variable that holds the first", () => {
    expect(formatPortBlock({ base: 50010, size: 10 })).toBe('Ports 50010–50019 · CHORD_PORT=50010');
  });
});

describe('deriveRunTabSignal', () => {
  it('is quiet with nothing running and no failed test', () => {
    expect(deriveRunTabSignal(undefined)).toBe('neutral');
    expect(deriveRunTabSignal(runs({ web: script({ status: 'exited', exitCode: 0 }) }))).toBe(
      'neutral'
    );
    expect(deriveRunTabSignal(runs({}, test({ status: 'passed', exitCode: 0 })))).toBe('neutral');
    // A test run the user stopped is not a failure: no red dot.
    expect(deriveRunTabSignal(runs({}, test({ status: 'stopped', exitCode: 1 })))).toBe('neutral');
  });

  it('is ok while a script or the tests run', () => {
    expect(deriveRunTabSignal(runs({ web: script({ status: 'running' }) }))).toBe('success');
    expect(deriveRunTabSignal(runs({}, test({ status: 'running' })))).toBe('success');
  });

  it('is an error when the last test failed, even with a script running', () => {
    expect(
      deriveRunTabSignal(
        runs({ web: script({ status: 'running' }) }, test({ status: 'failed', exitCode: 1 }))
      )
    ).toBe('danger');
  });
});

describe('describeStartError', () => {
  it('words each refusal for the user', () => {
    expect(describeStartError({ type: 'setup_running' })).toBe(
      'Setup is still running, so dependencies may be missing. Start again once it finishes.'
    );
    expect(describeStartError({ type: 'declined' })).toBe(
      "You chose Don't run, so nothing ran. Start again to review the script."
    );
    expect(describeStartError({ type: 'no_script' })).toBe(
      'The repository no longer has this script.'
    );
    expect(describeStartError({ type: 'already_running' })).toBe('It is already running.');
    expect(describeStartError({ type: 'checkout_missing' })).toBe(
      "This lane's checkout is not on this machine."
    );
    expect(describeStartError({ type: 'not_found' })).toBe('This lane no longer exists.');
    expect(describeStartError({ type: 'config_invalid', message: '.chord.json: bad JSON' })).toBe(
      '.chord.json: bad JSON'
    );
  });
});

describe('isRunTabEmpty', () => {
  it('is empty only when the repository has neither run scripts nor a test script', () => {
    expect(isRunTabEmpty({ scripts: [], hasTest: false })).toBe(true);
    expect(isRunTabEmpty({ scripts: [], hasTest: true })).toBe(false);
    expect(isRunTabEmpty({ scripts: [{ id: 'default', title: 'Run' }], hasTest: false })).toBe(
      false
    );
  });
});
