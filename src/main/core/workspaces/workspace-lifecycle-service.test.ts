import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { LocalTerminalProvider } from '@main/core/terminals/impl/local-terminal-provider';
import { LifecycleScriptService } from './workspace-lifecycle-service';

/**
 * A lifecycle script (teardown) runs as its own shell-line process and is
 * done when that process exits. It used to be typed into an interactive
 * shell as `<script>; exit`: cmd.exe does not split on `;`, so on Windows
 * the shell never exited — and the wait listened for the exit on the IPC
 * channel main sends to the renderer, which main itself never hears. Every
 * teardown sat out its 10 s timeout. Real terminal provider, real process;
 * only the IPC emitter is substituted (it needs Electron's main process).
 */
vi.mock('@main/lib/events', () => ({
  events: { emit: () => {}, on: () => () => {}, once: () => () => {} },
}));

/** A service on a fresh workspace folder, removed when the test that made it finishes. */
function createService(): { service: LifecycleScriptService; dir: string } {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-')));
  onTestFinished(() =>
    vi.waitFor(() => fs.rmSync(dir, { recursive: true, force: true }), { timeout: 10_000 })
  );
  const terminals = new LocalTerminalProvider({
    projectId: 'project-1',
    scopeId: 'lane-1',
    taskPath: dir,
    ctx: new LocalExecutionContext({ root: dir }),
    taskEnvVars: { CHORD_LANE_ID: 'lane-1' },
  });
  return {
    service: new LifecycleScriptService({
      projectId: 'project-1',
      workspaceId: 'lane-1',
      terminals,
    }),
    dir,
  };
}

/** Settles with `promise`, or rejects after `ms` saying it never finished. */
function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`still running after ${ms} ms`)), ms)
    ),
  ]);
}

describe('LifecycleScriptService', () => {
  it("runs a script in the workspace with the lane's env and returns once it exits", async () => {
    const { service, dir } = createService();
    const script = `node -e "require('fs').writeFileSync('teardown.txt', process.env.CHORD_LANE_ID)"`;

    await within(
      service.runLifecycleScript({ type: 'teardown', script }, { waitForExit: true }),
      8_000
    );

    expect(fs.readFileSync(path.join(dir, 'teardown.txt'), 'utf8')).toBe('lane-1');
    await service.dispose();
  });

  it('returns once a script that fails exits, too', async () => {
    const { service, dir } = createService();
    // The script's work is done before it fails: a service that returned before
    // the exit would leave ran.txt unwritten when the wait resolved.
    const script = `node -e "require('fs').writeFileSync('ran.txt', 'x'); process.exit(4)"`;

    await expect(
      within(service.runLifecycleScript({ type: 'teardown', script }, { waitForExit: true }), 8_000)
    ).resolves.toBeUndefined();

    expect(fs.readFileSync(path.join(dir, 'ran.txt'), 'utf8')).toBe('x');
    await service.dispose();
  });
});
