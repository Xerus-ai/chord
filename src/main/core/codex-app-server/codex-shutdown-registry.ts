import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Codex servers told to close that have not exited yet, per CODEX_HOME. One
 * still going down holds the home's state; a server started on that home
 * meanwhile exits with code 1, so a start waits for these first. In-process
 * only: a codex run by another program on the same home is out of its reach.
 */
const closingByHome = new Map<string, Set<Promise<void>>>();

/**
 * The last start or shutdown in line per CODEX_HOME. A server opens the
 * home's sqlite state as it starts and again as it shuts down; one starting
 * while another on the home starts or shuts down exits with code 1, "failed to
 * initialize sqlite state runtime" (codex-cli 0.154.0, Windows). A running
 * server blocks nothing. Measured on raw `codex app-server` processes: a start
 * overlapping a start failed 4 of 32 times, overlapping a shutdown 7 of 8,
 * after the other had exited 0 of 8.
 */
const transitionsByHome = new Map<string, Promise<void>>();

/**
 * Runs `step` — a server's start (until it answers `initialize`) or its
 * shutdown (until it exits) — once every earlier step on the same home has
 * settled, so no two of them overlap.
 */
export function runCodexHomeTransition<T>(homeKey: string, step: () => Promise<T>): Promise<T> {
  const previous = transitionsByHome.get(homeKey) ?? Promise.resolve();
  const run = previous.then(step);
  const settled = run.then(
    () => undefined,
    () => undefined
  );
  transitionsByHome.set(homeKey, settled);
  void settled.then(() => {
    if (transitionsByHome.get(homeKey) === settled) transitionsByHome.delete(homeKey);
  });
  return run;
}

/**
 * The folder a server's state lives in, as one key however it is spelled: an
 * unset CODEX_HOME is codex's default `~/.codex`; paths are resolved, and on
 * Windows compared without case.
 */
export function resolveCodexHomeKey(env: NodeJS.ProcessEnv): string {
  const home = resolve(env.CODEX_HOME || join(homedir(), '.codex'));
  return process.platform === 'win32' ? home.toLowerCase() : home;
}

/** Records a closing server until `exited` settles. */
export function trackCodexShutdown(homeKey: string, exited: Promise<void>): void {
  let closing = closingByHome.get(homeKey);
  if (!closing) {
    closing = new Set();
    closingByHome.set(homeKey, closing);
  }
  closing.add(exited);
  void exited.then(() => forget(homeKey, exited));
}

function forget(homeKey: string, exited: Promise<void>): void {
  const closing = closingByHome.get(homeKey);
  if (!closing) return;
  closing.delete(exited);
  if (closing.size === 0) closingByHome.delete(homeKey);
}

/**
 * Resolves once every closing server of the home has exited. A server that
 * has not exited within `timeoutMs` fails this start with an error naming it,
 * and is no longer waited for — it fails one start, not every start after it.
 */
export async function waitForCodexShutdowns(homeKey: string, timeoutMs: number): Promise<void> {
  const closing = closingByHome.get(homeKey);
  if (!closing || closing.size === 0) return;
  const pending = [...closing];
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'timed_out'>((done) => {
    timer = setTimeout(() => done('timed_out'), timeoutMs);
  });
  try {
    const outcome = await Promise.race([Promise.all(pending), timeout]);
    if (outcome !== 'timed_out') return;
  } finally {
    clearTimeout(timer);
  }
  for (const exited of pending) forget(homeKey, exited);
  throw new Error(
    `A closed codex app-server (CODEX_HOME ${homeKey}) did not exit within ${timeoutMs / 1000}s`
  );
}
