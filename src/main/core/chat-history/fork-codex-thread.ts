import { CodexAppServerClient } from '@main/core/codex-app-server/app-server-client';
import type { ThreadForkParams } from '@main/core/codex-app-server/protocol/v2/ThreadForkParams';
import type { ThreadForkResponse } from '@main/core/codex-app-server/protocol/v2/ThreadForkResponse';
import type { ThreadTurnsListParams } from '@main/core/codex-app-server/protocol/v2/ThreadTurnsListParams';
import type { ThreadTurnsListResponse } from '@main/core/codex-app-server/protocol/v2/ThreadTurnsListResponse';

async function listTurnIds(client: CodexAppServerClient, threadId: string): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  do {
    const params: ThreadTurnsListParams = {
      threadId,
      cursor,
      sortDirection: 'asc',
      itemsView: 'notLoaded',
    };
    const page: ThreadTurnsListResponse = await client.request('thread/turns/list', params);
    ids.push(...page.data.map((turn) => turn.id));
    cursor = page.nextCursor;
  } while (cursor !== null);
  return ids;
}

/**
 * Forks a Codex thread through the turn `historyRef` (inclusive) into `cwd`.
 * Runs on a short-lived app-server: the fork reads the thread from disk and
 * calls no model. The original thread keeps every turn (spike S2);
 * `thread/rollback` is deprecated and never used. A fork keeps its turns'
 * ids, so `turnIds` are the history refs still valid in it.
 */
export function forkCodexThread(args: {
  command: string;
  threadId: string;
  historyRef: string;
  cwd: string;
}): Promise<{ threadId: string; turnIds: string[] }> {
  return CodexAppServerClient.runOnce(args.command, args.cwd, async (client) => {
    const params: ThreadForkParams = {
      threadId: args.threadId,
      lastTurnId: args.historyRef,
      cwd: args.cwd,
      excludeTurns: true,
    };
    const response = await client.request<ThreadForkResponse>('thread/fork', params);
    const threadId = response.thread.id;
    return { threadId, turnIds: await listTurnIds(client, threadId) };
  });
}
