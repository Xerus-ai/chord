import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CodexAppServerClient } from './app-server-client';
import { listCodexModels } from './codex-catalog';

// Real CLI, no mocks: the installed `codex app-server`. No turn is started,
// so nothing is billed.
describe('CodexAppServerClient (real codex app-server)', () => {
  it('names why the server exited, even when no stderr handler is given', async () => {
    const missingHome = join(homedir(), 'chord-test-missing-codex-home');

    await expect(
      CodexAppServerClient.start({
        command: 'codex',
        cwd: homedir(),
        env: { ...process.env, CODEX_HOME: missingHome },
        handlers: {
          onNotification: () => {},
          onServerRequest: () => {},
          onError: () => {},
          onExit: () => {},
        },
      })
    ).rejects.toThrow(/exited \(code 1\): .*CODEX_HOME points to/s);
  });

  // A server started while a closed one is still going down shares its
  // CODEX_HOME state; closing must leave that state usable at once.
  it('starts a new server right after closing one', { timeout: 60_000 }, async () => {
    for (let i = 0; i < 3; i++) {
      const models = await CodexAppServerClient.runOnce('codex', homedir(), listCodexModels);
      expect(models.length).toBeGreaterThan(0);
    }
  });
});
