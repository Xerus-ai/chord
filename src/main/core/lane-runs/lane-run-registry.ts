import { laneRunChangedChannel } from '@shared/events/laneRunEvents';
import { describeRunScriptEnd, describeTestEnd } from '@shared/lane-process-end';
import type { LaneRunState, LaneTestState, RunScriptState } from '@shared/lane-runs';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { stopLaneProcess, type LaneProcess } from './lane-process';

/**
 * The run state of every lane, in this run of the app: per lane, each run
 * script's process and the test's (plan §Phase 4, Processes — runtime only,
 * nothing in the database). Every change is announced on
 * `laneRunChangedChannel` with the lane's whole state.
 *
 * A process is keyed `run:<scriptId>` or `test`. Imports nothing from
 * `worktrees/`, which calls in here when a lane goes.
 */

type ProcessKey = `run:${string}` | 'test';

interface TrackedProcess {
  proc: LaneProcess;
  stopRequested: boolean;
  /** Settles once the exit is recorded in the state. */
  recorded: Promise<void>;
}

interface LaneEntry {
  scripts: Map<string, RunScriptState>;
  test: LaneTestState;
  processes: Map<ProcessKey, TrackedProcess>;
  /** Starts between their checks and their spawn (asking the user, say). */
  starting: Set<ProcessKey>;
}

const IDLE_TEST: LaneTestState = {
  status: 'idle',
  exitCode: null,
  startedAt: null,
  finishedAt: null,
  durationMs: null,
  ptySessionId: null,
};

const lanes = new Map<string, LaneEntry>();

/** SGR dim on and off, for the line a lane process's terminal ends with. */
const DIM = '\x1b[2m';
const UNDIM = '\x1b[22m';

export const runProcessKey = (scriptId: string): ProcessKey => `run:${scriptId}`;
export const TEST_PROCESS_KEY: ProcessKey = 'test';

function entryOf(laneId: string): LaneEntry {
  let entry = lanes.get(laneId);
  if (!entry) {
    entry = { scripts: new Map(), test: IDLE_TEST, processes: new Map(), starting: new Set() };
    lanes.set(laneId, entry);
  }
  return entry;
}

export function readLaneRunState(laneId: string): LaneRunState {
  const entry = lanes.get(laneId);
  if (!entry) return { laneId, scripts: {}, test: IDLE_TEST };
  return { laneId, scripts: Object.fromEntries(entry.scripts), test: entry.test };
}

function announce(laneId: string): void {
  events.emit(laneRunChangedChannel, readLaneRunState(laneId));
}

/**
 * Holds `key` for a start that has passed no check yet: false when the
 * process runs, is stopping, or another start holds it.
 */
export function claimLaneProcessStart(laneId: string, key: ProcessKey): boolean {
  const entry = entryOf(laneId);
  if (entry.processes.has(key) || entry.starting.has(key)) return false;
  entry.starting.add(key);
  return true;
}

/**
 * Whether a start still holds `key`: false once the lane was released
 * meanwhile (deleted, archived) — its checkout is going, so nothing may start
 * in it.
 */
export function isLaneProcessStartClaimed(laneId: string, key: ProcessKey): boolean {
  return lanes.get(laneId)?.starting.has(key) ?? false;
}

export function releaseLaneProcessStart(laneId: string, key: ProcessKey): void {
  lanes.get(laneId)?.starting.delete(key);
}

function track(
  laneId: string,
  key: ProcessKey,
  proc: LaneProcess,
  /** Records the exit; returns how the process ended, in its row's words. */
  onExit: (tracked: TrackedProcess, exitCode: number | null) => string
): void {
  const entry = entryOf(laneId);
  const tracked = { proc, stopRequested: false } as TrackedProcess;
  tracked.recorded = proc.exited.then(({ exitCode }) => {
    if (entry.processes.get(key) === tracked) entry.processes.delete(key);
    const ended = onExit(tracked, exitCode ?? null);
    // The terminal says so too, not only the row (devstation-0eth).
    ptySessionRegistry.appendOutput(proc.sessionId, `\r\n${DIM}[${ended}]${UNDIM}\r\n`);
    announce(laneId);
  });
  entry.processes.set(key, tracked);
  announce(laneId);
}

export function trackRunScript(laneId: string, scriptId: string, proc: LaneProcess): void {
  const entry = entryOf(laneId);
  entry.scripts.set(scriptId, {
    status: 'running',
    exitCode: null,
    startedAt: Date.now(),
    url: null,
    ptySessionId: proc.sessionId,
  });
  track(laneId, runProcessKey(scriptId), proc, (tracked, exitCode) => {
    const status = tracked.stopRequested ? 'stopped' : 'exited';
    const current = entry.scripts.get(scriptId);
    // A restart's new process already holds the row; this one's terminal still ends.
    if (current && current.ptySessionId === proc.sessionId) {
      entry.scripts.set(scriptId, { ...current, status, exitCode, url: null });
    }
    return describeRunScriptEnd(status, exitCode);
  });
}

/** The URL a running script printed, or null once it is gone. */
export function setRunScriptUrl(
  laneId: string,
  scriptId: string,
  proc: LaneProcess,
  url: string | null
): void {
  const entry = lanes.get(laneId);
  const current = entry?.scripts.get(scriptId);
  if (!entry || !current || entry.processes.get(runProcessKey(scriptId))?.proc !== proc) return;
  entry.scripts.set(scriptId, { ...current, url });
  announce(laneId);
}

export function trackLaneTest(laneId: string, proc: LaneProcess): void {
  const entry = entryOf(laneId);
  const startedAt = Date.now();
  entry.test = { ...IDLE_TEST, status: 'running', startedAt, ptySessionId: proc.sessionId };
  track(laneId, TEST_PROCESS_KEY, proc, (tracked, exitCode) => {
    const finishedAt = Date.now();
    const status = tracked.stopRequested ? 'stopped' : exitCode === 0 ? 'passed' : 'failed';
    entry.test = {
      status,
      exitCode,
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      ptySessionId: proc.sessionId,
    };
    return describeTestEnd(status, exitCode);
  });
}

async function stopProcess(laneId: string, key: ProcessKey): Promise<void> {
  const entry = lanes.get(laneId);
  const tracked = entry?.processes.get(key);
  if (!entry || !tracked) return;
  if (!tracked.stopRequested) {
    tracked.stopRequested = true;
    if (key !== TEST_PROCESS_KEY) {
      const scriptId = key.slice('run:'.length);
      const current = entry.scripts.get(scriptId);
      if (current) entry.scripts.set(scriptId, { ...current, status: 'stopping' });
      announce(laneId);
    }
  }
  await stopLaneProcess(tracked.proc);
  await tracked.recorded;
}

export async function stopLaneRun(laneId: string, scriptId: string): Promise<LaneRunState> {
  await stopProcess(laneId, runProcessKey(scriptId));
  return readLaneRunState(laneId);
}

export async function stopLaneTest(laneId: string): Promise<LaneRunState> {
  await stopProcess(laneId, TEST_PROCESS_KEY);
  return readLaneRunState(laneId);
}

/** Stops every run script and the test of a lane, together; resolves once all are gone. */
export async function stopLaneRuns(laneId: string): Promise<void> {
  const entry = lanes.get(laneId);
  if (!entry) return;
  await Promise.all([...entry.processes.keys()].map((key) => stopProcess(laneId, key)));
}

/**
 * Before a lane's checkout goes (delete, archive, re-pointing it): stops all
 * it runs, then drops its state and its terminals' buffers.
 */
export async function releaseLaneRuns(laneId: string): Promise<void> {
  const entry = lanes.get(laneId);
  if (!entry) return;
  await stopLaneRuns(laneId);
  const sessionIds = [...entry.scripts.values(), entry.test]
    .map((state) => state.ptySessionId)
    .filter((id): id is string => id !== null);
  for (const sessionId of sessionIds) ptySessionRegistry.unregister(sessionId);
  lanes.delete(laneId);
  announce(laneId);
}

export function hasActiveLaneRuns(): boolean {
  return [...lanes.values()].some((entry) => entry.processes.size > 0);
}

/** App quit: every lane's runs, stopped as Stop stops them. Never rejects. */
export async function stopEveryLaneRun(): Promise<void> {
  await Promise.all(
    [...lanes.keys()].map((laneId) =>
      stopLaneRuns(laneId).catch((error: unknown) => {
        log.error('[lane-runs] a run outlived the stop at quit', { laneId, error: String(error) });
      })
    )
  );
}
