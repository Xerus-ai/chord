import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  ACP_TEST_AGENT_SESSION_ID,
  isProcessRunning,
  readAcpTestAgentPids,
  writeAcpTestAgent,
} from '@main/core/acp/_testing/acp-test-agent';
import { AcpLiveControls } from '@main/core/acp/acp-live-controls';
import { AcpSDKClient } from '@main/core/acp/acp-sdk-client';
import { getAcpConnection, setAcpConnection } from '@main/core/acp/acp-session-store';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { teardownSession } from './session-teardown';

/**
 * Tearing down a live ACP chat session leaves its lane free. Lane Delete
 * (`deleteWorktree` → `stopWorktreeSessions` → `stopSession`) awaits this
 * teardown and then removes the checkout; on Windows a folder a live process
 * sits in can't be removed, so a teardown that only asks the agent to go
 * raced its exit (EPERM). Real processes: `node` running a small ACP agent
 * that, like opencode, starts a helper in the lane which does not hold its
 * stdio. The lane is removed without retries the moment the teardown resolves.
 * The database is the real migrated schema in memory: the app's file needs
 * Electron's `app` for its path.
 */
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const root = realpathSync(mkdtempSync(join(tmpdir(), 'chord-acp-teardown-')));

afterAll(() => {
  removeDirSync(root);
});

describe('teardownSession (ACP chat session)', () => {
  it('resolves only once the agent and what it started in the lane are gone', async () => {
    const sessionId = 'session-acp-teardown';
    const lane = join(root, 'lane');
    mkdirSync(lane);
    const agent = writeAcpTestAgent(root, 'tidy-acp-agent', null);
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
    const started = await connection.start();
    expect(started.sessionId).toBe(ACP_TEST_AGENT_SESSION_ID);
    setAcpConnection(
      sessionId,
      connection,
      new AcpLiveControls(
        sessionId,
        'opencode',
        started.controls,
        (method, params) => connection.requestForSession(method, params),
        () => {}
      )
    );
    const pids = readAcpTestAgentPids(agent);
    expect(isProcessRunning(pids.agent)).toBe(true);
    expect(isProcessRunning(pids.helper)).toBe(true);

    await teardownSession(
      { sessionId, workItemId: 'item-1', providerId: 'opencode', mode: 'acp', kind: 'chat' },
      { isOrphaned: false }
    );

    expect(getAcpConnection(sessionId)).toBeUndefined();
    expect({
      agent: isProcessRunning(pids.agent),
      helper: isProcessRunning(pids.helper),
    }).toEqual({ agent: false, helper: false });
    rmSync(lane, { recursive: true });
    expect(existsSync(lane)).toBe(false);
  });
});
