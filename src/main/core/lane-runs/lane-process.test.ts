import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawnLaneProcess } from './lane-process';

/**
 * The environment a lane's run and test scripts start with. Only the IPC
 * emitter is substituted: it needs Electron's main process.
 */
vi.mock('@main/lib/events', () => ({
  events: { emit: () => {}, on: () => () => {}, once: () => () => {} },
}));

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await vi.waitFor(() => fs.rmSync(dir, { recursive: true, force: true }), {
      timeout: 5_000,
      interval: 100,
    });
  }
});

describe('spawnLaneProcess', () => {
  // `docker compose up` attached to a terminal shows a keyboard menu that
  // reads Ctrl+C as a key, so Stop's Ctrl+C never reached it and the tree
  // kill left its containers running (solo-docker e2e, probe-ctrlc). Without
  // the menu, Ctrl+C stops the stack in about a second.
  it("starts scripts with Compose's keyboard menu off, whatever the lane env says", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chord-lane-process-'));
    dirs.push(dir);
    const out = path.join(dir, 'env.txt').replace(/\\/g, '/');
    const proc = spawnLaneProcess({
      sessionId: 'lane-process-env',
      cwd: dir,
      commandLine: `node -e "require('fs').writeFileSync('${out}', String(process.env.COMPOSE_MENU))"`,
      env: { COMPOSE_MENU: 'true' },
    });

    const exit = await proc.exited;

    expect(exit.exitCode).toBe(0);
    expect(fs.readFileSync(out, 'utf8')).toBe('false');
  });
});
