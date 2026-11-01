import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@main/db/client';
import { chatMessages } from '@main/db/schema-work-items';

const DESCRIPTION_MAX_LENGTH = 200;

function truncateDescription(content: string): string {
  const trimmed = content.trim();
  return trimmed.length > DESCRIPTION_MAX_LENGTH
    ? `${trimmed.slice(0, DESCRIPTION_MAX_LENGTH)}…`
    : trimmed;
}

export interface NewestTurnTimes {
  byWorkItem: Map<string, number>;
  byWorktree: Map<string, number>;
}

/**
 * The newest persisted `agent_turn` timestamp per work item, and per
 * worktree. A turn's worktree is its session's (session id null, or a
 * teammate's session this device never created, attributes to the primary —
 * cloud-ingested turns carry no local session row at all).
 */
export async function readNewestTurnTimes(
  ids: string[],
  sessionWorktreeId: ReadonlyMap<string, string>,
  primaryWorktreeIdByWorkItem: ReadonlyMap<string, string>
): Promise<NewestTurnTimes> {
  const turnRows = await db
    .select({
      workItemId: chatMessages.workItemId,
      sessionId: chatMessages.sessionId,
      createdAt: chatMessages.createdAt,
    })
    .from(chatMessages)
    .where(and(inArray(chatMessages.workItemId, ids), eq(chatMessages.messageType, 'agent_turn')));

  const byWorkItem = new Map<string, number>();
  const byWorktree = new Map<string, number>();
  for (const turn of turnRows) {
    const priorItem = byWorkItem.get(turn.workItemId) ?? 0;
    if (turn.createdAt > priorItem) byWorkItem.set(turn.workItemId, turn.createdAt);

    const worktreeId =
      (turn.sessionId ? sessionWorktreeId.get(turn.sessionId) : undefined) ??
      primaryWorktreeIdByWorkItem.get(turn.workItemId);
    if (!worktreeId) continue;
    const priorWorktree = byWorktree.get(worktreeId) ?? 0;
    if (turn.createdAt > priorWorktree) byWorktree.set(worktreeId, turn.createdAt);
  }
  return { byWorkItem, byWorktree };
}

/** First human chat message per work item, truncated for the hover card. */
export async function readDescriptions(ids: string[]): Promise<Map<string, string>> {
  const rows = await db
    .select({
      workItemId: chatMessages.workItemId,
      content: chatMessages.content,
      createdAt: chatMessages.createdAt,
    })
    .from(chatMessages)
    .where(
      and(
        inArray(chatMessages.workItemId, ids),
        eq(chatMessages.senderType, 'human'),
        eq(chatMessages.messageType, 'text')
      )
    );

  const firstByWorkItem = new Map<string, { content: string; createdAt: number }>();
  for (const row of rows) {
    const current = firstByWorkItem.get(row.workItemId);
    if (!current || row.createdAt < current.createdAt) firstByWorkItem.set(row.workItemId, row);
  }

  const descriptions = new Map<string, string>();
  for (const [workItemId, row] of firstByWorkItem) {
    descriptions.set(workItemId, truncateDescription(row.content));
  }
  return descriptions;
}
