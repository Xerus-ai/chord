import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CodexAppServerClient } from '@main/core/codex-app-server/app-server-client';
import {
  resolveCodexHomeKey,
  waitForCodexShutdowns,
} from '@main/core/codex-app-server/codex-shutdown-registry';
import type { ThreadTurnsListParams } from '@main/core/codex-app-server/protocol/v2/ThreadTurnsListParams';
import type { ThreadTurnsListResponse } from '@main/core/codex-app-server/protocol/v2/ThreadTurnsListResponse';
import {
  CODEX_THREAD_ID,
  CODEX_TURN_1_ID,
  CODEX_TURN_2_ID,
  seedCodexRollout,
} from './_testing/seed-transcripts';
import { forkCodexThread } from './fork-codex-thread';

// The installed `codex app-server`, against a CODEX_HOME holding only the
// recorded thread: a fork reads the rollout from disk and calls no model.
// This file shares one worker with the other real-Codex suites (isolate:
// false), so CODEX_HOME is put back afterwards.
let codexHome: string;
let cwd: string;
const previousCodexHome = process.env.CODEX_HOME;

beforeAll(() => {
  codexHome = realpathSync(mkdtempSync(join(tmpdir(), 'chord-fork-codex-home-')));
  cwd = realpathSync(mkdtempSync(join(tmpdir(), 'chord-fork-codex-cwd-')));
  process.env.CODEX_HOME = codexHome;
  seedCodexRollout(codexHome, cwd);
});

afterAll(async () => {
  // A closed server still exiting holds the home's files (EPERM on removal).
  await waitForCodexShutdowns(resolveCodexHomeKey(process.env), 20_000);
  if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = previousCodexHome;
  rmSync(codexHome, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

function listTurnIds(threadId: string): Promise<string[]> {
  return CodexAppServerClient.runOnce('codex', cwd, async (client) => {
    // Oldest first: the server lists newest first by default.
    const params: ThreadTurnsListParams = { threadId, sortDirection: 'asc' };
    const page = await client.request<ThreadTurnsListResponse>('thread/turns/list', params);
    return page.data.map((turn) => turn.id);
  });
}

describe('forkCodexThread (real codex app-server, recorded thread)', () => {
  it('forks through the turn: the fork holds turn 1 only, and the original keeps both', async () => {
    const { threadId: forkId, turnIds } = await forkCodexThread({
      command: 'codex',
      threadId: CODEX_THREAD_ID,
      historyRef: CODEX_TURN_1_ID,
      cwd,
    });

    expect(forkId).not.toBe(CODEX_THREAD_ID);
    // A Codex fork keeps its turns' ids: these are the refs still valid in it.
    expect(turnIds).toEqual([CODEX_TURN_1_ID]);
    expect(await listTurnIds(forkId)).toEqual([CODEX_TURN_1_ID]);
    expect(await listTurnIds(CODEX_THREAD_ID)).toEqual([CODEX_TURN_1_ID, CODEX_TURN_2_ID]);
  });

  it('fails when the turn is not in the thread', async () => {
    await expect(
      forkCodexThread({
        command: 'codex',
        threadId: CODEX_THREAD_ID,
        historyRef: '01a10858-0000-7000-8000-000000000000',
        cwd,
      })
    ).rejects.toThrow();
  });
});
