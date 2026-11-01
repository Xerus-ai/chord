import type { AgentQuestion, AgentQuestionAnswers } from '@shared/agent-questions';
import { defineEvent } from '@shared/ipc/events';

// Source of truth for artifact content types; main's artifact-utils derives
// its extension map from this.
export type ArtifactType =
  | 'markdown'
  | 'mdx'
  | 'text'
  | 'image'
  | 'document'
  | 'web'
  // A `.tsx` entry bundled in main against the vendored React runtime and
  // rendered as a page (plan 2026-09-23 §2.2 "Interactive prototype").
  | 'prototype';

export type ToolCallStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface ToolContentBlock {
  type: 'text' | 'diff';
  text?: string;
  diff?: string;
}

export interface ToolFileLocation {
  filePath: string;
  startLine?: number;
  endLine?: number;
}

export interface ToolCallItem {
  callId: string;
  name: string;
  status: ToolCallStatus;
  kind: string;
  content?: string;
  contentBlocks?: ToolContentBlock[];
  locations?: ToolFileLocation[];
  rawInput?: Record<string, unknown>;
}

export interface SubagentItem {
  agentId: string;
  name: string;
  description: string;
  status: 'running' | 'completed' | 'failed';
  model?: string;
}

export interface TaskListEntry {
  text: string;
  completed: boolean;
  status?: string;
  sourceCallId?: string;
}

export type StreamItem =
  | { kind: 'thinking'; id: string; text: string; status: 'loading' | 'ready'; startedAt: number }
  | { kind: 'text'; id: string; text: string }
  | { kind: 'tool_group'; id: string; tools: ToolCallItem[] }
  | {
      kind: 'permission';
      id: string;
      requestId: string;
      name: string;
      title: string;
      command?: string;
      options: PermissionOption[];
      // Set by the shared answer path (acp/respond-to-permission.ts) whoever
      // answered — owner click or a teammate's permission_response command —
      // so the pinned card clears without waiting for the turn to complete.
      resolved?: boolean;
    }
  | {
      /**
       * Questions the agent is waiting on (`QuestionTracker`). Pinned above
       * the composer while pending; the transcript shows the answers, secret
       * ones masked.
       */
      kind: 'question';
      id: string;
      requestId: string;
      questions: AgentQuestion[];
      status: 'pending' | 'answered' | 'dismissed';
      answers?: AgentQuestionAnswers;
    }
  | {
      kind: 'task_list';
      id: string;
      title: string;
      entries: TaskListEntry[];
      completedCount: number;
      totalCount: number;
    }
  | { kind: 'subagent'; id: string; agents: SubagentItem[] }
  | {
      kind: 'file_changes';
      id: string;
      files: Array<{ name: string; filePath: string; added: number; removed: number }>;
    }
  | {
      /**
       * Documents the agent wrote this turn without publishing them — offered
       * as "Add to artifacts" chips. Emitted once, at turn end.
       */
      kind: 'unpublished_documents';
      id: string;
      files: Array<{ name: string; filePath: string }>;
    }
  | {
      kind: 'artifact';
      id: string;
      artifactId: string;
      filePath: string;
      title: string;
      type: ArtifactType;
      preview: string;
    }
  | {
      kind: 'plan_approval';
      id: string;
      artifactId: string;
      title: string;
      overview: string;
      steps: Array<{ text: string; completed: boolean }>;
      /**
       * 'adjusted' = the user sent feedback; the agent revises and presents a
       * new plan. 'expired' = the session ended while the plan was pending —
       * nothing is waiting on an answer anymore.
       */
      status: 'pending' | 'approved' | 'rejected' | 'adjusted' | 'expired';
      rationale?: string;
      /** Raw plan markdown from ExitPlanMode — rendered as the card body when present. */
      planMarkdown?: string;
      /** The parked canUseTool requestId this card settles (claude-sdk transport only). */
      sessionRequestId?: string;
    }
  | { kind: 'error'; id: string; message: string };

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: string;
}

export interface AgentTurn {
  id: string;
  workItemId: string;
  agentName: string;
  items: StreamItem[];
  status: 'streaming' | 'complete';
  timestamp: number;
  /** ms epoch of turn start/completion; absent on turns persisted before these were stamped. */
  startedAt?: number;
  completedAt?: number;
  usage?: { inputTokens?: number; outputTokens?: number; totalCostUsd?: number };
  /** The agent_sessions row that produced this turn; absent on turns persisted before Phase 1. */
  sessionId?: string;
  /**
   * Where the agent's conversation can be cut after this turn (Reset, Fork).
   * Local to the owner's device: absent on a teammate's copy, on an ACP or
   * PTY agent's turn, and on turns from before Phase 5.
   */
  historyRef?: string;
}

export type TurnStreamAction =
  | { type: 'turn_started'; agentName: string; timestamp: number }
  | { type: 'item_added'; item: StreamItem }
  | { type: 'item_updated'; itemId: string; item: StreamItem }
  | { type: 'turn_completed'; timestamp?: number }
  | { type: 'items_batch'; actions: TurnStreamAction[] };

export interface TurnStreamEvent {
  workItemId: string;
  turnId: string;
  action: TurnStreamAction;
  seq?: number;
  epoch?: string;
  /** The agent_sessions row id of the emitting session — attributes the turn to a session tab. */
  sessionId?: string;
}

export const turnStreamChannel = defineEvent<TurnStreamEvent>('turn-stream');
