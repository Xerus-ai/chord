import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import {
  ACP_TEST_AGENT_MODELS,
  isProcessRunning,
  readAcpTestAgentPids,
  writeAcpTestAgent,
} from './_testing/acp-test-agent';
import { getAcpConnection } from './acp-session-store';
import { launchAcpSession } from './launch-acp-session';

/**
 * A launch that fails after the agent's session is open leaves nothing
 * running in the lane. The connection is registered as soon as the session
 * is open, then the stored model and mode are applied to it; when the agent
 * refused that, the launch rejected with the agent, what it started in the
 * lane, and its registration all left behind — no session was registered, so
 * no teardown would ever stop it, and on Windows the lane's folder could then
 * not be removed.
 *
 * The real launch runs opencode's ACP bridge (`opencode acp`), found on the
 * PATH of the lane environment it is given; that PATH leads first to an
 * `opencode` that runs a small real ACP agent (`node`) which refuses
 * `session/set_config_option`. The database is the real migrated schema in
 * memory: the app's file needs Electron's `app` for its path.
 */
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const root = realpathSync(mkdtempSync(join(tmpdir(), 'chord-acp-launch-')));

afterAll(() => {
  removeDirSync(root);
});

/** A directory holding an `opencode` executable that runs `script` with node. */
function writeOpencodeShim(script: string): string {
  const bin = join(root, 'bin');
  mkdirSync(bin);
  if (process.platform === 'win32') {
    writeFileSync(join(bin, 'opencode.cmd'), `@"${process.execPath}" "${script}" %*\r\n`);
  } else {
    const shim = join(bin, 'opencode');
    writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
    chmodSync(shim, 0o755);
  }
  return bin;
}

/** The lane environment: this process's PATH with `bin` first, under the key the OS uses. */
function laneEnvWithPathFirst(bin: string): Record<string, string> {
  const key = Object.keys(process.env).find((name) => name.toUpperCase() === 'PATH') ?? 'PATH';
  return { [key]: `${bin}${delimiter}${process.env[key] ?? ''}` };
}

describe('launchAcpSession', () => {
  it('stops the agent and forgets the session when applying the stored model fails', async () => {
    const sessionId = 'session-launch-refused';
    const lane = join(root, 'lane');
    mkdirSync(lane);
    const agent = writeAcpTestAgent(root, 'refuses-config', 'session/set_config_option');
    const bin = writeOpencodeShim(agent.script);

    await expect(
      launchAcpSession(sessionId, {
        workItemId: 'item-1',
        cwd: lane,
        providerId: 'opencode',
        resolveSelection: () => ({ model: ACP_TEST_AGENT_MODELS.other, effort: null, fast: false }),
        permissionMode: null,
        artifactTools: null,
        env: laneEnvWithPathFirst(bin),
        onExit: () => {},
      })
    ).rejects.toThrow('test agent refused session/set_config_option');

    const pids = readAcpTestAgentPids(agent);
    expect(getAcpConnection(sessionId)).toBeUndefined();
    expect({
      agent: isProcessRunning(pids.agent),
      helper: isProcessRunning(pids.helper),
    }).toEqual({ agent: false, helper: false });
    rmSync(lane, { recursive: true });
    expect(existsSync(lane)).toBe(false);
  });
});
