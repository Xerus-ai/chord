import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { and, desc, eq } from 'drizzle-orm';
import { getAgentDisplayName } from '@shared/agent-display-name';
import { isValidProviderId } from '@shared/agent-provider-registry';
import { err, ok, type Result } from '@shared/result';
import { resolveTransport } from '@main/core/work-items/launch-session-transport';
import { db } from '@main/db/client';
import { checkpoints, type CheckpointRow } from '@main/db/schema-checkpoints';
import {
  agentSessions,
  chatMessages,
  type AgentSessionRow,
  type WorkItemWorktreeRow,
} from '@main/db/schema-work-items';
import type { HistoryPoint } from './fork-conversation';

export type HistoryRefusalType =
  | 'turn_not_found'
  | 'no_checkpoint'
  | 'lane_missing'
  | 'lane_archived'
  | 'no_history_point'
  | 'turn_running'
  | 'lane_not_created';

export interface HistoryRefusal {
  type: HistoryRefusalType;
  message: string;
}

export function refuseHistory(type: HistoryRefusalType, message: string) {
  return err<HistoryRefusal>({ type, message });
}

type ChatMessageRow = typeof chatMessages.$inferSelect;

/** A turn of a chat on this device: its `agent_turn` row and the chat it belongs to. */
export interface ChatTurn {
  turnRow: ChatMessageRow;
  session: AgentSessionRow;
}

export function findChatTurn(workItemId: string, turnId: string): Result<ChatTurn, HistoryRefusal> {
  const [turnRow] = db
    .select()
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.workItemId, workItemId),
        eq(chatMessages.messageType, 'agent_turn'),
        eq(chatMessages.turnId, turnId)
      )
    )
    .limit(1)
    .all();
  const [session] = turnRow?.sessionId
    ? db.select().from(agentSessions).where(eq(agentSessions.id, turnRow.sessionId)).limit(1).all()
    : [];
  if (!turnRow || !session) {
    return refuseHistory('turn_not_found', 'This turn is not in a chat on this device.');
  }
  return ok({ turnRow, session });
}

/** The turn's newest `turn_completed` checkpoint, the one Reset and Fork read; undefined when none was saved. */
export function findTurnCheckpoint(workItemId: string, turnId: string): CheckpointRow | undefined {
  return db
    .select()
    .from(checkpoints)
    .where(
      and(
        eq(checkpoints.workItemId, workItemId),
        eq(checkpoints.turnId, turnId),
        eq(checkpoints.trigger, 'turn_completed')
      )
    )
    .orderBy(desc(checkpoints.createdAt))
    .limit(1)
    .all()[0];
}

/** The lane's checkout, refused when it is not on this machine or is archived. */
export function checkLanePresent(
  lane: WorkItemWorktreeRow | undefined
): Result<WorkItemWorktreeRow, HistoryRefusal> {
  if (!lane || !existsSync(lane.path)) {
    return refuseHistory('lane_missing', "This turn's lane is not on this machine.");
  }
  if (lane.archivedAt !== null) {
    return refuseHistory('lane_archived', "This turn's lane is archived.");
  }
  return ok(lane);
}

/**
 * Where the chat's conversation can be cut at this turn: only a Claude or
 * Codex chat whose turn reported a history ref has one. An ACP agent, or a
 * turn from before history refs, has none.
 */
export function resolveHistoryPoint(
  chatTurn: ChatTurn,
  cwd: string
): Result<HistoryPoint & { agentName: string }, HistoryRefusal> {
  const { turnRow, session } = chatTurn;
  const providerId = session.agentProviderId;
  if (!providerId || !isValidProviderId(providerId)) {
    return refuseHistory('no_history_point', 'This chat has no agent to rewind.');
  }
  const agentName = getAgentDisplayName(providerId);
  const transport = resolveTransport(providerId, session.kind === 'terminal' ? 'terminal' : 'chat');
  if (
    (transport !== 'claude-sdk' && transport !== 'codex-app-server') ||
    !turnRow.historyRef ||
    !session.externalSessionId
  ) {
    return refuseHistory(
      'no_history_point',
      `${agentName}'s conversation has no point to go back to at this turn.`
    );
  }
  return ok({
    providerId,
    agentName,
    transport,
    externalSessionId: session.externalSessionId,
    historyRef: turnRow.historyRef,
    cwd: resolve(cwd),
  });
}
