import type { AgentTurn, StreamItem, SubagentItem } from '@shared/stream-items';
import type { ChatEntry } from './chat-types';

/**
 * Pure selection rules for a chat thread: its human and system rows
 * interleaved with its agent turns.
 */

/**
 * The rows a thread renders: human rows, and system rows that carry a message.
 * Agent-authored rows (legacy replies) and the empty system-event placeholders
 * `dbRowToChatEntry` makes of `agent_turn` rows are rendered as turns instead,
 * so they are dropped here.
 */
export function selectThreadEntries(entries: readonly ChatEntry[]): ChatEntry[] {
  return entries.filter((entry) =>
    entry.kind === 'message' ? entry.sender === 'human' : entry.message !== ''
  );
}

export type TranscriptItem =
  | {
      sort: number;
      type: 'message';
      entry: ChatEntry;
      /** The command a teammate's prompt was sent as; its chip shows delivery. */
      commandId?: string;
    }
  | { sort: number; type: 'turn'; turn: AgentTurn }
  /**
   * Where a feed that mixes agent sessions crosses into another one: only the
   * teammate's item chat, which shows every session's rows, has these.
   */
  | {
      sort: number;
      type: 'divider';
      key: string;
      /** 1-based order of the session's first appearance in the feed. */
      ordinal: number;
      /** Epoch seconds of the group's first row. */
      startedAt: number;
    };

/** A message or a turn: every row but a divider, which only a mixed-session feed has. */
export type ThreadRow = Exclude<TranscriptItem, { type: 'divider' }>;

/**
 * One thread's transcript: its prompts (rows already scoped to the session by
 * `getMessages`, plus the work item's session-less history) interleaved with
 * its turns by time, in milliseconds. A turn sits where it started, which is
 * after the prompt it answers and before any prompt sent once it finished,
 * even within one second (devstation-vihv); a turn with no start time (an
 * older or imported one) sits where it was recorded. A turn is the rendering
 * of the reply, so agent rows are dropped rather than shown twice.
 */
export function buildSessionTranscript(
  entries: readonly ChatEntry[],
  turns: readonly AgentTurn[]
): ThreadRow[] {
  const items: ThreadRow[] = [];
  for (const entry of selectThreadEntries(entries)) {
    items.push({ sort: entry.createdAtMs, type: 'message', entry });
  }
  for (const turn of turns) {
    items.push({ sort: turn.startedAt ?? turn.timestamp * 1000, type: 'turn', turn });
  }
  return items.sort((a, b) => a.sort - b.sort);
}

type PermissionItem = Extract<StreamItem, { kind: 'permission' }>;

/**
 * The newest unanswered permission request in a still-running turn, skipping
 * one the local user just dismissed. `resolved` also covers a teammate having
 * answered it through the command channel.
 */
export function selectPendingPermission(
  latestTurn: AgentTurn | undefined,
  dismissedId: string | null
): PermissionItem | null {
  if (!latestTurn || latestTurn.status === 'complete') return null;
  for (let i = latestTurn.items.length - 1; i >= 0; i--) {
    const item = latestTurn.items[i];
    if (item.kind === 'permission' && !item.resolved && item.id !== dismissedId) return item;
  }
  return null;
}

type QuestionItem = Extract<StreamItem, { kind: 'question' }>;

/** The newest question a still-running turn is waiting on. */
export function selectPendingQuestion(latestTurn: AgentTurn | undefined): QuestionItem | null {
  if (!latestTurn || latestTurn.status === 'complete') return null;
  for (let i = latestTurn.items.length - 1; i >= 0; i--) {
    const item = latestTurn.items[i];
    if (item.kind === 'question' && item.status === 'pending') return item;
  }
  return null;
}

/** The running subagents of the first in-flight turn that has any. */
export function selectRunningSubagents(turns: readonly AgentTurn[]): SubagentItem[] {
  for (const turn of turns) {
    if (turn.status === 'complete') continue;
    for (const item of turn.items) {
      if (item.kind !== 'subagent') continue;
      const running = item.agents.filter((a) => a.status === 'running');
      if (running.length > 0) return running;
    }
  }
  return [];
}
