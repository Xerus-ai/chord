import { homedir } from 'node:os';
import { describe, expect, it } from 'vitest';
import type { AgentOutputEvent } from '@shared/events/agentOutputEvents';
import { CodexAppServerClient } from './app-server-client';
import { CODEX_SESSION_FEATURES, startCodexSession } from './codex-session';
import type { ExperimentalFeatureListParams } from './protocol/v2/ExperimentalFeatureListParams';
import type { ExperimentalFeatureListResponse } from './protocol/v2/ExperimentalFeatureListResponse';
import type { ThreadStartResponse } from './protocol/v2/ThreadStartResponse';

// Over the app-server's input limit (1,048,576 characters): it rejects the
// turn/start itself with -32602 input_too_large, before any model call.
const OVERSIZED_MESSAGE = 'x'.repeat(1_048_577);

function waitFor(condition: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = (): void => {
      if (condition()) resolve();
      else if (Date.now() > deadline) reject(new Error('timed out'));
      else setTimeout(poll, 50);
    };
    poll();
  });
}

describe('CodexSession queue (real codex app-server)', () => {
  it('sends a message queued behind a turn/start the server rejected', async () => {
    const events: AgentOutputEvent[] = [];
    const session = await startCodexSession({
      command: 'codex',
      cwd: homedir(),
      selection: { model: null, effort: null, fast: false },
      permissionMode: () => null,
      onEvent: (event) => events.push(event),
      onThreadId: () => {},
      onStderr: () => {},
      onExit: () => {},
    });
    try {
      session.sendMessage(OVERSIZED_MESSAGE);
      // Arrives while the first turn/start is in flight, so it is queued; the
      // second rejection proves it was sent once the first start failed.
      session.sendMessage(OVERSIZED_MESSAGE);
      const completed = () => events.filter((e) => e.type === 'turn_completed').length;
      await waitFor(() => completed() === 2, 30_000);

      const errors = events.filter((e) => e.type === 'error');
      expect(errors).toHaveLength(2);
      for (const error of errors) {
        expect(error.type === 'error' && error.message).toMatch(
          /turn\/start failed \(-32602\): Input exceeds the maximum length/
        );
      }
    } finally {
      session.close();
    }
  }, 60_000);
});

// Real CLI: the feature list the app-server itself reports for a thread. No
// turn is started, so nothing is billed.
describe('CodexSession features (real codex app-server)', () => {
  it('gives session threads the request_permissions tool', { timeout: 60_000 }, async () => {
    const client = await CodexAppServerClient.start({
      command: 'codex',
      cwd: homedir(),
      enableFeatures: CODEX_SESSION_FEATURES,
      handlers: {
        onNotification: () => {},
        onServerRequest: () => {},
        onError: () => {},
        onExit: () => {},
      },
    });
    try {
      const { thread } = await client.request<ThreadStartResponse>('thread/start', {
        cwd: homedir(),
      });
      const { data } = await client.request<ExperimentalFeatureListResponse>(
        'experimentalFeature/list',
        { threadId: thread.id, limit: 500 } satisfies ExperimentalFeatureListParams
      );
      const feature = data.find((f) => f.name === 'request_permissions_tool');
      expect(feature?.enabled).toBe(true);
    } finally {
      client.close();
    }
  });
});
