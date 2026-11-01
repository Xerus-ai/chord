export type ToolCallStatus = 'pending' | 'in_progress' | 'completed' | 'failed';
export type ToolCallKind = 'read' | 'edit' | 'execute' | 'search' | 'fetch' | 'unknown';

export interface FileBadgeData {
  name: string;
  added: number;
  removed: number;
}

export interface ArtifactData {
  artifactId?: string;
  title: string;
  meta: string;
  hasApprove?: boolean;
}

export interface ToolCallBlockData {
  callId: string;
  name: string;
  status: ToolCallStatus;
  kind: ToolCallKind;
  summary?: string;
  content?: string;
}

export interface PermissionOptionData {
  optionId: string;
  name: string;
  kind: string;
}

export interface PlanEntryData {
  text: string;
  completed: boolean;
}

export interface PullRequestCardData {
  prNumber: number;
  title: string;
  branch: string;
  targetBranch: string;
  added: number;
  removed: number;
  checksText?: string;
  checksPassed?: boolean;
  url?: string;
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; summary: string }
  | { type: 'tool-call-rich'; data: ToolCallBlockData }
  | { type: 'tool-sequence'; calls: ToolCallBlockData[] }
  | { type: 'file-badges'; files: FileBadgeData[] }
  | { type: 'artifact'; data: ArtifactData }
  | { type: 'code-block'; code: string }
  | { type: 'reasoning'; text: string; status: 'loading' | 'ready'; durationSec?: number }
  | {
      type: 'permission';
      requestId: string;
      name: string;
      title: string;
      command?: string;
      options: PermissionOptionData[];
      resolved?: boolean;
      resolvedOptionId?: string;
    }
  | {
      type: 'plan';
      entries: PlanEntryData[];
      completedCount: number;
      totalCount: number;
    }
  | {
      type: 'plan-approval';
      artifactId: string;
      /**
       * Stream item id the agent waits on — what `rpc.acp.respondToPlan`
       * addresses. Absent on rows written before it was persisted, which is
       * why a rebuilt card can be unanswerable.
       */
      planItemId?: string;
      title: string;
      overview: string;
      steps: PlanEntryData[];
      status: 'pending' | 'approved' | 'rejected' | 'adjusted';
      rationale?: string;
      /** Raw plan markdown from ExitPlanMode — the card body when present. */
      planMarkdown?: string;
    }
  | { type: 'error'; message: string }
  | { type: 'pr-card'; data: PullRequestCardData };

export interface ChatMessageEntry {
  kind: 'message';
  id: string;
  sender: 'human' | 'agent';
  /** Cloud user id of the author; null on legacy local rows (this device's owner). */
  senderId: string | null;
  /** `chat_messages.session_id` (agent_sessions.id) that produced the row, when known. */
  sessionId?: string;
  name: string;
  initials: string;
  time: string;
  /** Epoch seconds. */
  createdAt: number;
  /** The same moment to the millisecond: what a chat is ordered by. */
  createdAtMs: number;
  avatarStyle?: { bg: string; fg: string };
  blocks: ContentBlock[];
}

export interface SystemEventEntry {
  kind: 'system-event';
  id: string;
  commitHash: string;
  message: string;
  /** `chat_messages.session_id` (agent_sessions.id) that produced the row, when known. */
  sessionId?: string;
  /** Row creation time, same units as ChatMessageEntry — a commit event belongs where it happened. */
  createdAt: number;
  createdAtMs: number;
  /** Set when the row's metadata could not be parsed; the row renders degraded instead of vanishing. */
  degraded?: boolean;
  /**
   * A history event. `history_reset`: a Reset to an earlier turn; the turns
   * between `targetTurnId` and this row are no longer in the agent's memory.
   * `forked_from`: the head of a forked chat, naming the chat and the time of
   * the turn it was forked from.
   */
  event?:
    | { type: 'history_reset'; targetTurnId: string }
    | { type: 'forked_from'; sourceTitle: string; forkedAt: number };
}

export type ChatEntry = ChatMessageEntry | SystemEventEntry;
