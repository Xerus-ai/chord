import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { labelAgentSession } from '@shared/agent-session-label';
import { announceSessionsChanged } from '@main/core/agent-sessions/announce-sessions-changed';
import { scheduleSessionCloudSync } from '@main/core/agent-sessions/session-cloud-sync';
import {
  getChatSessionConfig,
  setChatSessionConfig,
} from '@main/core/agent-sessions/session-config-store';
import { copyTurnCheckpoint } from '@main/core/checkpoints/checkpoint-service';
import { recordChatExternalId } from '@main/core/work-items/chat-resume-state';
import { db } from '@main/db/client';
import { checkpoints } from '@main/db/schema-checkpoints';
import { agentSessions, type AgentSessionRow } from '@main/db/schema-work-items';
import { copyThreadToSession, FORKED_FROM_EVENT } from './copy-thread';
import type { ForkedConversation } from './fork-conversation';
import type { ChatTurn } from './history-point';

/** A lane the copied checkpoints move to, when the fork is on another lane. */
interface CheckpointLane {
  worktreeId: string;
  branchName: string | null;
}

/** Each copied turn gets its own copy of its source turn's checkpoint. */
async function copyTurnCheckpoints(
  workItemId: string,
  turnIds: ReadonlyMap<string, string>,
  sessionId: string,
  repoPath: string,
  lane: CheckpointLane | undefined
): Promise<void> {
  if (turnIds.size === 0) return;
  const sources = db
    .select()
    .from(checkpoints)
    .where(
      and(
        eq(checkpoints.workItemId, workItemId),
        eq(checkpoints.trigger, 'turn_completed'),
        inArray(checkpoints.turnId, [...turnIds.keys()])
      )
    )
    .all();
  // The newest checkpoint per turn, as Reset reads it.
  const newest = new Map<string, (typeof sources)[number]>();
  for (const row of sources) {
    const current = row.turnId ? newest.get(row.turnId) : undefined;
    if (row.turnId && (!current || current.createdAt < row.createdAt)) newest.set(row.turnId, row);
  }
  for (const [sourceTurnId, source] of newest) {
    const turnId = turnIds.get(sourceTurnId) as string;
    await copyTurnCheckpoint(source, { turnId, sessionId, repoPath, lane });
  }
}

function insertForkSession(
  source: AgentSessionRow,
  fork: { externalId: string; title: string; cwd: string; worktreeId: string }
): string {
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  db.insert(agentSessions)
    .values({
      id,
      workItemId: source.workItemId,
      kind: 'chat',
      agentProviderId: source.agentProviderId,
      communication: source.communication,
      externalSessionId: fork.externalId,
      title: fork.title,
      cwd: fork.cwd,
      worktreeId: fork.worktreeId,
      model: source.model,
      status: 'active',
      createdAt: now,
      lastActiveAt: now,
    })
    .run();
  const config = getChatSessionConfig(source.id);
  if (Object.keys(config).length > 0) setChatSessionConfig(id, config);
  recordChatExternalId(id, fork.externalId);
  return id;
}

/**
 * The chat a fork opens (plan §"Decisions for Phase 5", Fork): a new session
 * of the source's agent and model on `lane`, resuming the forked
 * conversation, with the source chat's rows up to the turn copied in under a
 * "Forked from" row and each copied turn given its own checkpoint copy.
 * `checkpointLane` moves those copies to the fork's lane (Fork to new
 * worktree); a fork on the same lane leaves them on the source's. Returns
 * the new chat's id. Both forks are titled "<source> (fork)"; a fork on its
 * own lane reads apart by the lane its tab names ("Claude Code (fork) · fork",
 * devstation-6z9s).
 */
export async function createForkedChat(args: {
  chatTurn: ChatTurn;
  fork: ForkedConversation;
  /** `path` is the lane's checkout, where checkpoints live; `cwd` where the chat runs. */
  lane: { id: string; path: string; cwd: string };
  checkpointLane?: CheckpointLane;
}): Promise<string> {
  const { session, turnRow } = args.chatTurn;
  const workItemId = session.workItemId;
  const turnId = turnRow.turnId as string;
  const sourceTitle = labelAgentSession(session);
  const sessionId = insertForkSession(session, {
    externalId: args.fork.externalId,
    title: `${sourceTitle} (fork)`,
    cwd: args.lane.cwd,
    worktreeId: args.lane.id,
  });
  const turnIds = copyThreadToSession({
    workItemId,
    sourceSessionId: session.id,
    targetTurnId: turnId,
    sessionId,
    head: {
      content: `Forked from ${sourceTitle}`,
      metadata: {
        event: FORKED_FROM_EVENT,
        sourceSessionId: session.id,
        sourceTurnId: turnId,
        sourceTitle,
        forkedAt: turnRow.createdAt,
      },
    },
    mapRef: args.fork.mapRef,
  });
  await copyTurnCheckpoints(workItemId, turnIds, sessionId, args.lane.path, args.checkpointLane);

  scheduleSessionCloudSync(workItemId);
  announceSessionsChanged(workItemId);
  return sessionId;
}
