import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  resolveCodexHomeKey,
  trackCodexShutdown,
  waitForCodexShutdowns,
} from './codex-shutdown-registry';

/**
 * A closed `codex app-server` holds its CODEX_HOME state until it exits; a
 * server started on the same home meanwhile exits with code 1. Starts wait for
 * shutdowns of the same home — matched by the folder, not by how it is spelled
 * — and a server that never exits fails one start, not every start after it.
 */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('resolveCodexHomeKey', () => {
  it('treats an unset CODEX_HOME as the default folder, spelled out', () => {
    expect(resolveCodexHomeKey({})).toBe(
      resolveCodexHomeKey({ CODEX_HOME: join(homedir(), '.codex') })
    );
  });

  it('matches the same folder written with a trailing separator', () => {
    const home = join(homedir(), 'some-codex-home');
    expect(resolveCodexHomeKey({ CODEX_HOME: `${home}/` })).toBe(
      resolveCodexHomeKey({ CODEX_HOME: home })
    );
  });

  it.runIf(process.platform === 'win32')('ignores letter case on Windows', () => {
    const home = join(homedir(), 'Some-Codex-Home');
    expect(resolveCodexHomeKey({ CODEX_HOME: home.toUpperCase() })).toBe(
      resolveCodexHomeKey({ CODEX_HOME: home })
    );
  });

  it('keeps different folders apart', () => {
    expect(resolveCodexHomeKey({ CODEX_HOME: join(homedir(), 'a') })).not.toBe(
      resolveCodexHomeKey({ CODEX_HOME: join(homedir(), 'b') })
    );
  });
});

describe('waitForCodexShutdowns', () => {
  it('waits until a closing server of the same home has exited', async () => {
    const exit = deferred();
    trackCodexShutdown('home-wait', exit.promise);
    let started = false;
    const start = waitForCodexShutdowns('home-wait', 5_000).then(() => {
      started = true;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(started).toBe(false);
    exit.resolve();
    await start;
    expect(started).toBe(true);
  });

  it('does not wait for a server of another home', async () => {
    trackCodexShutdown('home-busy', new Promise<void>(() => {}));
    await expect(waitForCodexShutdowns('home-free', 5_000)).resolves.toBeUndefined();
  });

  it('fails one start for a server that never exits, then lets the next start through', async () => {
    trackCodexShutdown('home-stuck', new Promise<void>(() => {}));
    await expect(waitForCodexShutdowns('home-stuck', 50)).rejects.toThrow(/did not exit within/);
    await expect(waitForCodexShutdowns('home-stuck', 50)).resolves.toBeUndefined();
  });
});
