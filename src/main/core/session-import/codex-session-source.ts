import { homedir } from 'node:os';
import { getProvider } from '@shared/agent-providers';
import type { ImportableSession } from '@shared/session-import';
import { resolveAgentExecutable } from '@main/core/agent-sessions/resolve-agent-executable';
import { CodexAppServerClient } from '@main/core/codex-app-server/app-server-client';
import type { Thread } from '@main/core/codex-app-server/protocol/v2/Thread';
import type { ThreadListResponse } from '@main/core/codex-app-server/protocol/v2/ThreadListResponse';
import type { ThreadReadParams } from '@main/core/codex-app-server/protocol/v2/ThreadReadParams';
import type { ThreadReadResponse } from '@main/core/codex-app-server/protocol/v2/ThreadReadResponse';
import type { ThreadTurnsListResponse } from '@main/core/codex-app-server/protocol/v2/ThreadTurnsListResponse';
import type { Turn } from '@main/core/codex-app-server/protocol/v2/Turn';
import { comparablePath } from '@main/core/utils/comparable-path';
import { SessionNotFoundError, type ProviderSessionHistory } from './claude-session-source';
import {
  buildCodexImportMessages,
  buildCodexThreadListParams,
  buildCodexTurnsPageParams,
  selectImportableCodexThreads,
} from './codex-history';

function codexCommand(): Promise<string> {
  return resolveAgentExecutable({ providerId: 'codex', cli: getProvider('codex')?.cli });
}

/**
 * Where the short-lived app-server runs: never a lane. Its requests name the
 * lane themselves, and `runOnce` closes the server without waiting for it to
 * exit — on Windows a server still sitting in a lane's folder makes a lane
 * Delete right after fail with EPERM.
 */
const SERVER_CWD = homedir();

async function listThreads(client: CodexAppServerClient, cwd: string): Promise<Thread[]> {
  const threads: Thread[] = [];
  let cursor: string | null = null;
  do {
    const page: ThreadListResponse = await client.request(
      'thread/list',
      buildCodexThreadListParams(cwd, cursor)
    );
    threads.push(...page.data);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return threads;
}

/**
 * Each lane's Codex threads Chord does not own, over one short-lived
 * app-server: `thread/list` filters by cwd on the server (spike S5).
 */
export async function listCodexImportableSessions(
  lanes: { worktreeId: string; path: string }[],
  owned: ReadonlySet<string>
): Promise<Map<string, ImportableSession[]>> {
  const found = new Map<string, ImportableSession[]>();
  if (lanes.length === 0) return found;
  return CodexAppServerClient.runOnce(await codexCommand(), SERVER_CWD, async (client) => {
    for (const lane of lanes) {
      found.set(
        lane.worktreeId,
        selectImportableCodexThreads(await listThreads(client, lane.path), lane.path, owned)
      );
    }
    return found;
  });
}

/**
 * A Codex thread's metadata and every turn with full items, paged oldest
 * first (`thread/turns/list`). The resume after import keeps
 * `excludeTurns: true` (codex-session.ts): this history is already in the chat.
 */
export async function readCodexThreadHistory(
  lanePath: string,
  threadId: string
): Promise<ProviderSessionHistory> {
  return CodexAppServerClient.runOnce(await codexCommand(), SERVER_CWD, async (client) => {
    const { thread }: ThreadReadResponse = await client.request('thread/read', {
      threadId,
    } satisfies ThreadReadParams);
    if (comparablePath(thread.cwd) !== comparablePath(lanePath))
      throw new SessionNotFoundError(threadId);
    const turns: Turn[] = [];
    let cursor: string | null = null;
    do {
      const page: ThreadTurnsListResponse = await client.request(
        'thread/turns/list',
        buildCodexTurnsPageParams(threadId, cursor)
      );
      turns.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor !== null);
    return {
      title: thread.name ?? (thread.preview || null),
      lastActivityAt: thread.updatedAt * 1000,
      messages: buildCodexImportMessages(turns, lanePath),
    };
  });
}
