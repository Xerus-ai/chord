import type { AcpPermissionRequest, AcpSessionUpdate } from '@shared/acp-types';
import type { AgentOutputEvent, UsageInfo } from '@shared/events/agentOutputEvents';

const RECOGNIZED_KINDS = new Set(['read', 'edit', 'execute', 'search', 'fetch', 'agent', 'task']);

function inferToolKind(name: string): string {
  const lower = name.toLowerCase();
  if (
    lower.includes('read') ||
    lower === 'cat' ||
    lower === 'ls' ||
    lower === 'head' ||
    lower === 'tail' ||
    lower === 'view'
  )
    return 'read';
  if (
    lower.includes('edit') ||
    lower.includes('write') ||
    lower.includes('multiedit') ||
    lower.includes('patch') ||
    lower.includes('replace') ||
    lower.includes('insert')
  )
    return 'edit';
  if (
    lower.includes('glob') ||
    lower.includes('grep') ||
    lower.includes('search') ||
    lower.includes('find') ||
    lower.includes('rg') ||
    lower.includes('locate')
  )
    return 'search';
  if (
    lower.includes('fetch') ||
    lower.includes('web') ||
    lower.includes('url') ||
    lower.includes('http') ||
    lower.includes('curl')
  )
    return 'fetch';
  if (
    lower.includes('agent') ||
    lower.includes('spawn') ||
    lower.includes('delegate') ||
    lower.includes('subagent')
  )
    return 'agent';
  if (
    lower.includes('bash') ||
    lower.includes('exec') ||
    lower.includes('command') ||
    lower.includes('shell') ||
    lower.includes('run') ||
    lower.includes('terminal') ||
    lower.includes('powershell')
  )
    return 'execute';
  if (lower.includes('task') || lower.includes('todo') || lower.includes('plan')) return 'task';
  if (lower.includes('notebook') || lower.includes('jupyter')) return 'read';
  return 'execute';
}

/** The tool-card kind of an ACP tool call: the agent's own kind when Chord draws it, else from the title. */
export function resolveAcpToolKind(kind: string | null | undefined, title: string): string {
  return kind && RECOGNIZED_KINDS.has(kind) ? kind : inferToolKind(title);
}

/**
 * The turn's token counts from its `session/prompt` reply — what the chat
 * records as the completed turn's usage, as the Claude path does from its
 * `result`. Null when the agent reports none (usage is optional in ACP).
 */
export function mapAcpPromptUsage(reply: {
  stopReason: string;
  usage?: unknown;
}): UsageInfo | null {
  const { usage } = reply;
  if (usage === undefined || usage === null) return null;
  const { inputTokens, outputTokens } = usage as Record<string, unknown>;
  if (typeof inputTokens !== 'number' || typeof outputTokens !== 'number') {
    throw new Error(`Malformed ACP prompt usage: ${JSON.stringify(usage)}`);
  }
  return { inputTokens, outputTokens };
}

/**
 * A `usage_update` as session telemetry: `used` of `size` tokens is the
 * context fill, `cost.amount` the session's running total. A cost in another
 * currency is not reported, since the composer shows dollars.
 */
export function mapAcpUsageUpdate(
  update: Extract<AcpSessionUpdate, { sessionUpdate: 'usage_update' }>
): AgentOutputEvent[] {
  const events: AgentOutputEvent[] = [
    { type: 'context_usage', usedTokens: update.used, maxTokens: update.size },
  ];
  if (update.cost && update.cost.currency === 'USD') {
    events.push({ type: 'usage', totalCostUsd: update.cost.amount });
  }
  return events;
}

export function convertSessionUpdate(update: AcpSessionUpdate): AgentOutputEvent | null {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
      // claude-agent-acp forwards the SDK's `content_block_start` for a text
      // block as an empty chunk — the only block boundary on the wire.
      if (!update.content.text) return { type: 'text_block_start' };
      return { type: 'text', text: update.content.text, messageId: update.messageId };

    case 'agent_thought_chunk':
      if (!update.content.text) return null;
      return { type: 'reasoning', text: update.content.text };

    case 'tool_call': {
      const toolName = update.title ?? 'Tool Call';
      return {
        type: 'tool_call',
        callId: update.toolCallId,
        name: toolName,
        status: update.status,
        kind: resolveAcpToolKind(update.kind, toolName),
        title: update.title,
        rawInput: update.rawInput,
        content: update.content,
        locations: update.locations,
      };
    }

    case 'tool_call_update': {
      const hasPayload = update.rawInput || (update.content && update.content.length > 0);
      if (!update.status && !hasPayload) return null;
      return {
        type: 'tool_call_update',
        callId: update.toolCallId,
        status: update.status ?? (hasPayload ? 'in_progress' : 'in_progress'),
        rawInput: update.rawInput,
        content: update.content,
      };
    }

    case 'plan':
      return {
        type: 'plan',
        entries: update.entries,
      };

    case 'usage_update':
      return mapAcpUsageUpdate(update).find((e) => e.type === 'usage') ?? null;

    // The session's live controls (acp-live-controls) own these.
    case 'config_option_update':
    case 'current_mode_update':
    case 'available_commands_update':
    case 'user_message_chunk':
      return null;

    default:
      return null;
  }
}

export function convertPermissionRequest(request: AcpPermissionRequest): AgentOutputEvent {
  return {
    type: 'permission_request',
    requestId: request.requestId,
    name: request.name,
    kind: request.kind,
    title: request.title,
    input: request.input,
    options: request.options,
  };
}
