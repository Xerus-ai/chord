import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startCodexSession } from './codex-session';

// Real CLI, no mocks: the installed `codex app-server`. No turn is started,
// so nothing is billed.
function openSession() {
  return startCodexSession({
    command: 'codex',
    cwd: homedir(),
    selection: { model: null, effort: null, fast: false },
    permissionMode: () => null,
    onEvent: () => {},
    onThreadId: () => {},
    onStderr: () => {},
    onExit: () => {},
  });
}

const inheritedCodexHome = process.env.CODEX_HOME;

describe('CodexSession restart (real codex app-server)', () => {
  afterEach(() => {
    if (inheritedCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = inheritedCodexHome;
  });

  // Closing a session ends the server's stdin and returns; the server then
  // takes a moment to release its CODEX_HOME state, longer once it holds a
  // thread. A session opened in that moment must still start.
  it('opens a new session right after closing one', async () => {
    for (let i = 0; i < 3; i++) {
      const session = await openSession();
      expect(session).toBeDefined();
      session.close();
    }
  }, 90_000);

  // The same folder reached two ways — CODEX_HOME unset (codex's default) and
  // the default spelled out — is one home: the second start still waits.
  it('waits for a closing server whose CODEX_HOME names the same folder differently', async () => {
    delete process.env.CODEX_HOME;
    const first = await openSession();
    first.close();
    process.env.CODEX_HOME = join(homedir(), '.codex');
    const second = await openSession();
    expect(second).toBeDefined();
    second.close();
  }, 90_000);
});
