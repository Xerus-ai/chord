import type { AcpToolCallStatus } from '@shared/acp-types';
import type { AgentOutputEvent } from '@shared/events/agentOutputEvents';
import { mapCodexRateLimitWindows } from '@shared/session-telemetry';
import type { AccountRateLimitsUpdatedNotification } from './protocol/v2/AccountRateLimitsUpdatedNotification';
import type { AgentMessageDeltaNotification } from './protocol/v2/AgentMessageDeltaNotification';
import type { FileUpdateChange } from './protocol/v2/FileUpdateChange';
import type { ItemCompletedNotification } from './protocol/v2/ItemCompletedNotification';
import type { ItemStartedNotification } from './protocol/v2/ItemStartedNotification';
import type { ReasoningSummaryTextDeltaNotification } from './protocol/v2/ReasoningSummaryTextDeltaNotification';
import type { ThreadItem } from './protocol/v2/ThreadItem';
import type { ThreadTokenUsageUpdatedNotification } from './protocol/v2/ThreadTokenUsageUpdatedNotification';
import type { TurnCompletedNotification } from './protocol/v2/TurnCompletedNotification';
import type { TurnPlanUpdatedNotification } from './protocol/v2/TurnPlanUpdatedNotification';

type CommandItem = Extract<ThreadItem, { type: 'commandExecution' }>;
type FileChangeItem = Extract<ThreadItem, { type: 'fileChange' }>;

/** What a shell item runs: the parsed action when there is one, not the shell wrapper around it. */
export function describeCommand(item: CommandItem): string {
  return item.commandActions.length === 1 ? item.commandActions[0].command : item.command;
}

const CHANGE_VERBS: Record<FileUpdateChange['kind']['type'], string> = {
  add: 'Create',
  delete: 'Delete',
  update: 'Edit',
};

/** The last segment of a path Codex reported, whichever separator its host uses. */
function reportedFileName(reported: string): string {
  return (
    reported
      .split(/[\\/]/)
      .filter((segment) => segment.length > 0)
      .pop() ?? reported
  );
}

export function describeFileChange(item: FileChangeItem): string {
  const [first] = item.changes;
  if (item.changes.length !== 1 || !first) return `Edit ${item.changes.length} files`;
  return `${CHANGE_VERBS[first.kind.type]} ${reportedFileName(first.path)}`;
}

export function toToolStatus(status: string): AcpToolCallStatus {
  if (status === 'completed') return 'completed';
  if (status === 'inProgress') return 'in_progress';
  // `failed`, and `declined` — the user refused it, so it never ran.
  return 'failed';
}

function mapItemStarted(item: ThreadItem): AgentOutputEvent[] {
  switch (item.type) {
    case 'agentMessage':
      return [{ type: 'text_block_start' }];
    case 'commandExecution': {
      const command = describeCommand(item);
      return [
        {
          type: 'tool_call',
          callId: item.id,
          name: 'Shell',
          status: 'in_progress',
          kind: 'execute',
          title: command,
          rawInput: { command },
        },
      ];
    }
    case 'fileChange':
      return [
        {
          type: 'tool_call',
          callId: item.id,
          name: 'Edit',
          status: 'in_progress',
          kind: 'edit',
          title: describeFileChange(item),
          rawInput: { path: item.changes[0]?.path },
          locations: item.changes.map((c) => ({ filePath: c.path })),
          content: item.changes.map((c) => ({ type: 'diff' as const, diff: c.diff })),
        },
      ];
    case 'mcpToolCall':
      return [
        {
          type: 'tool_call',
          callId: item.id,
          name: `${item.server}.${item.tool}`,
          status: 'in_progress',
          title: `${item.server}.${item.tool}`,
          rawInput:
            typeof item.arguments === 'object' && item.arguments !== null
              ? (item.arguments as Record<string, unknown>)
              : undefined,
        },
      ];
    default:
      return [];
  }
}

function mapItemCompleted(item: ThreadItem): AgentOutputEvent[] {
  switch (item.type) {
    case 'commandExecution':
      return [
        {
          type: 'tool_call_update',
          callId: item.id,
          status: toToolStatus(item.status),
          ...(item.aggregatedOutput
            ? { content: [{ type: 'text' as const, text: item.aggregatedOutput }] }
            : {}),
        },
      ];
    case 'fileChange':
    case 'mcpToolCall':
      return [{ type: 'tool_call_update', callId: item.id, status: toToolStatus(item.status) }];
    // A plan-mode turn ends in a plan item: the plan put to the user.
    case 'plan':
      return [{ type: 'plan_request', requestId: item.id, plan: item.text, entries: [] }];
    // Agent messages were already streamed as deltas.
    default:
      return [];
  }
}

const PLAN_STEP_STATUS: Record<string, string> = { inProgress: 'in_progress' };

/** One app-server notification as the chat's agent events; empty for what the chat does not show. */
export function mapCodexNotification(method: string, params: unknown): AgentOutputEvent[] {
  switch (method) {
    case 'item/started':
      return mapItemStarted((params as ItemStartedNotification).item);
    case 'item/completed':
      return mapItemCompleted((params as ItemCompletedNotification).item);
    case 'item/agentMessage/delta': {
      const { delta, itemId } = params as AgentMessageDeltaNotification;
      return [{ type: 'text', text: delta, messageId: itemId }];
    }
    case 'item/reasoning/summaryTextDelta':
    case 'item/reasoning/textDelta':
      return [{ type: 'reasoning', text: (params as ReasoningSummaryTextDeltaNotification).delta }];
    case 'turn/plan/updated':
      return [
        {
          type: 'plan',
          entries: (params as TurnPlanUpdatedNotification).plan.map((s) => ({
            text: s.step,
            status: PLAN_STEP_STATUS[s.status] ?? s.status,
          })),
        },
      ];
    case 'thread/tokenUsage/updated': {
      const { tokenUsage } = params as ThreadTokenUsageUpdatedNotification;
      if (tokenUsage.modelContextWindow === null) return [];
      return [
        {
          type: 'context_usage',
          usedTokens: tokenUsage.last.totalTokens,
          maxTokens: tokenUsage.modelContextWindow,
        },
      ];
    }
    case 'account/rateLimits/updated': {
      const windows = mapCodexRateLimitWindows(
        (params as AccountRateLimitsUpdatedNotification).rateLimits
      );
      return windows.length > 0 ? [{ type: 'rate_limit', windows }] : [];
    }
    case 'turn/completed': {
      const { turn } = params as TurnCompletedNotification;
      // The turn id is where `thread/fork {lastTurnId}` cuts the thread; a
      // failed turn is still in the thread, so it is a history point too.
      const completed: AgentOutputEvent = { type: 'turn_completed', historyRef: turn.id };
      return turn.status === 'failed' && turn.error
        ? [{ type: 'error', message: turn.error.message }, completed]
        : [completed];
    }
    default:
      return [];
  }
}
