import type { CloudSession, CloudWorktree } from '@chord/protocol';
import { isValidProviderId, type AgentProviderId } from '@shared/agent-provider-registry';
import { labelAgentSession } from '@shared/agent-session-label';
import type { WorktreeBucket } from '@shared/work-item-status';
import { describeLaneTag, type Worktree } from '@shared/worktrees';

/**
 * A session as its tab needs it, from either source: an owner's
 * `agent_sessions` row satisfies it as is; a teammate's comes from the cloud
 * registry (`cloudSessionTabModel`).
 */
export interface SessionTabModel {
  id: string;
  workItemId: string;
  /** 'chat' or 'terminal'. */
  kind: string;
  title: string | null;
  agentProviderId: string | null;
  worktreeId: string | null;
  /** 'active' | 'suspended' | 'done' (and 'error' on the owner's rows). */
  status: string;
}

/** What a session tab reads of a worktree: which one is primary, and its branch. */
export type SessionWorktree = Pick<Worktree, 'id' | 'isPrimary' | 'branchName'>;

/** A cloud registry row as a tab. Terminals are never published, so it is a chat. */
export function cloudSessionTabModel(session: CloudSession): SessionTabModel {
  return {
    id: session.id,
    workItemId: session.work_item_id,
    kind: 'chat',
    title: session.title,
    agentProviderId: session.agent_provider_id,
    worktreeId: session.worktree_id,
    status: session.status,
  };
}

/** The owner's worktrees as the cloud publishes them, for a session tab's branch. */
export function cloudSessionWorktrees(worktrees: readonly CloudWorktree[]): SessionWorktree[] {
  return worktrees.map((w) => ({ id: w.id, isPrimary: w.is_primary, branchName: w.branch_name }));
}

export interface SessionTabDescriptor {
  label: string;
  kind: 'chat' | 'terminal';
  /** Keys `agentConfig` logos; null for terminals and unregistered providers. */
  providerId: AgentProviderId | null;
  /** The session worktree's branch; null while worktrees load or when detached. */
  branch: string | null;
  /**
   * The lane's short name for a session off the primary lane, shown after the
   * label so two tabs of one item on different lanes read apart
   * (devstation-5u6); null on the primary.
   */
  lane: string | null;
  /**
   * What the live status store can tell about this session, in the design's
   * priority order: `needs_input` while a permission or plan approval waits,
   * `failed` from the session row, `working` while a turn streams, otherwise
   * `idle`. Unread turns are not in that store, so `ready_to_review` is not
   * derivable here.
   */
  statusBucket: Extract<WorktreeBucket, 'needs_input' | 'failed' | 'working' | 'idle'>;
}

export interface SessionLiveStatus {
  isStreaming: boolean;
  hasPendingInput: boolean;
}

/** The agent_sessions status `deriveWorktreeStatus` reads as failed. */
const SESSION_ERROR_STATUS = 'error';

/**
 * The worktree a session runs in. A null `worktreeId` means the primary —
 * the same rule `resolveSessionWorktreeRow` applies on the main side.
 */
export function findSessionWorktree<W extends SessionWorktree>(
  worktrees: readonly W[] | undefined,
  worktreeId: string | null
): W | undefined {
  return worktrees?.find((w) => (worktreeId === null ? w.isPrimary : w.id === worktreeId));
}

/**
 * What a session's tab menu says about its history (plan §"Decisions for
 * Phase 5", Visibility): Reset and Fork need the agent's own conversation,
 * which an agent running in a terminal does not give Chord. Null for a chat,
 * and for a plain terminal, which has no history to speak of.
 */
export function describeSessionHistory(
  session: Pick<SessionTabModel, 'kind' | 'agentProviderId'>
): string | null {
  if (session.kind !== 'terminal' || !isValidProviderId(session.agentProviderId)) return null;
  return 'History unavailable for terminal chats';
}

export function describeSessionTab(
  session: Pick<SessionTabModel, 'kind' | 'title' | 'agentProviderId' | 'worktreeId' | 'status'>,
  worktrees: readonly SessionWorktree[] | undefined,
  live: SessionLiveStatus
): SessionTabDescriptor {
  const kind = session.kind === 'terminal' ? 'terminal' : 'chat';
  // A terminal keeps the terminal icon, so a Claude chat and Claude Code in a
  // terminal stay apart in the strip; both are named after the agent.
  const providerId =
    kind === 'chat' && isValidProviderId(session.agentProviderId) ? session.agentProviderId : null;
  const worktree = findSessionWorktree(worktrees, session.worktreeId);
  return {
    label: labelAgentSession(session),
    kind,
    providerId,
    branch: worktree?.branchName ?? null,
    lane:
      worktree && !worktree.isPrimary && worktree.branchName
        ? describeLaneTag(worktree.branchName)
        : null,
    statusBucket: live.hasPendingInput
      ? 'needs_input'
      : session.status === SESSION_ERROR_STATUS
        ? 'failed'
        : live.isStreaming
          ? 'working'
          : 'idle',
  };
}
