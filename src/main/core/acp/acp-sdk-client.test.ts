import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import {
  isProcessRunning,
  readAcpTestAgentPids,
  writeAcpTestAgent,
  type AcpTestAgentFailure,
} from './_testing/acp-test-agent';
import { AcpSDKClient } from './acp-sdk-client';

/**
 * An ACP session that fails to start leaves nothing running in its lane. The
 * agent is up before the handshake, so a refused `initialize` or `session/new`
 * left it, and what it started, in the lane: no session was registered, so no
 * teardown would ever stop it, and on Windows the lane's folder could then not
 * be removed. Real processes: `node` running a small ACP agent that refuses
 * one request and keeps running. The lane is removed without retries the
 * moment the start rejects.
 */
const root = realpathSync(mkdtempSync(join(tmpdir(), 'chord-acp-start-')));

afterAll(() => {
  removeDirSync(root);
});

describe('AcpSDKClient.start', () => {
  it.each<AcpTestAgentFailure>(['initialize', 'session/new'])(
    'stops the agent and what it started in the lane when %s is refused',
    async (failOn) => {
      const name = `refuses-${failOn!.replace('/', '-')}`;
      const lane = join(root, name);
      mkdirSync(lane);
      const agent = writeAcpTestAgent(root, name, failOn);
      const connection = new AcpSDKClient({
        command: process.execPath,
        args: [agent.script],
        cwd: lane,
        onSessionUpdate: () => {},
        onPermissionRequest: () => {},
        onError: (error) => {
          throw error;
        },
        onExit: () => {},
      });

      await expect(connection.start()).rejects.toThrow(`test agent refused ${failOn}`);

      const pids = readAcpTestAgentPids(agent);
      expect({
        agent: isProcessRunning(pids.agent),
        helper: isProcessRunning(pids.helper),
      }).toEqual({ agent: false, helper: false });
      rmSync(lane, { recursive: true });
      expect(existsSync(lane)).toBe(false);
    }
  );
});
