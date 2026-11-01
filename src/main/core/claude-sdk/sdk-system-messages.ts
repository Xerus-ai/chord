import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentOutputEvent } from '@shared/events/agentOutputEvents';

export function translateSystemMessage(
  msg: Extract<SDKMessage, { type: 'system' }>
): AgentOutputEvent[] {
  if (!('subtype' in msg)) return [];

  switch (msg.subtype) {
    case 'task_started': {
      const m = msg as Extract<SDKMessage, { type: 'system'; subtype: 'task_started' }>;
      if (m.skip_transcript) return [];
      return [
        {
          type: 'tool_call',
          callId: m.task_id,
          name: m.subagent_type ?? 'Agent',
          status: 'in_progress',
          kind: 'agent',
          rawInput: m.description ? { description: m.description } : undefined,
        },
      ];
    }

    case 'task_progress': {
      const m = msg as Extract<SDKMessage, { type: 'system'; subtype: 'task_progress' }>;
      return [
        {
          type: 'tool_call_update',
          callId: m.task_id,
          status: 'in_progress',
        },
      ];
    }

    case 'task_notification': {
      const m = msg as Extract<SDKMessage, { type: 'system'; subtype: 'task_notification' }>;
      return [
        {
          type: 'tool_call_update',
          callId: m.task_id,
          status: m.status === 'completed' ? 'completed' : 'failed',
          content: m.summary ? [{ type: 'text' as const, text: m.summary }] : undefined,
        },
      ];
    }

    case 'task_updated': {
      const m = msg as Extract<SDKMessage, { type: 'system'; subtype: 'task_updated' }>;
      const patch = m.patch;
      const status =
        patch.status === 'completed'
          ? 'completed'
          : patch.status === 'failed'
            ? 'failed'
            : 'in_progress';
      return [
        {
          type: 'tool_call_update',
          callId: m.task_id,
          status: status as 'in_progress' | 'completed' | 'failed',
        },
      ];
    }

    case 'compact_boundary': {
      const m = msg as Extract<SDKMessage, { type: 'system'; subtype: 'compact_boundary' }>;
      const trigger = m.compact_metadata.trigger === 'auto' ? 'automatically' : 'manually';
      return [
        {
          type: 'text',
          text: `Context ${trigger} compacted (${m.compact_metadata.pre_tokens.toLocaleString()} tokens before compaction).`,
        },
      ];
    }

    case 'permission_denied': {
      const m = msg as Extract<SDKMessage, { type: 'system'; subtype: 'permission_denied' }>;
      return [
        {
          type: 'error',
          message: `Permission denied: ${m.tool_name}`,
        },
      ];
    }

    case 'local_command_output': {
      const m = msg as Extract<SDKMessage, { type: 'system'; subtype: 'local_command_output' }>;
      if (!m.content) return [];
      return [{ type: 'text', text: m.content }];
    }

    case 'informational': {
      const m = msg as Extract<SDKMessage, { type: 'system'; subtype: 'informational' }>;
      if (!m.content) return [];
      if (m.level === 'warning') {
        return [{ type: 'error', message: m.content }];
      }
      return [{ type: 'text', text: m.content }];
    }

    case 'model_refusal_no_fallback': {
      const m = msg as Extract<
        SDKMessage,
        { type: 'system'; subtype: 'model_refusal_no_fallback' }
      >;
      return [
        {
          type: 'error',
          message: m.content || `Model refused request (${m.original_model})`,
        },
      ];
    }

    default:
      return [];
  }
}

/** `historyRef`: the turn's last main-chain transcript entry, where a fork can cut. */
export function translateResultMessage(
  msg: Extract<SDKMessage, { type: 'result' }>,
  historyRef: string | undefined
): AgentOutputEvent[] {
  const events: AgentOutputEvent[] = [];

  if (msg.subtype === 'success') {
    events.push({
      type: 'usage',
      inputTokens: msg.usage.input_tokens,
      outputTokens: msg.usage.output_tokens,
      totalCostUsd: msg.total_cost_usd,
    });
    events.push({
      type: 'turn_completed',
      usage: {
        inputTokens: msg.usage.input_tokens,
        outputTokens: msg.usage.output_tokens,
        totalCostUsd: msg.total_cost_usd,
      },
      ...(historyRef ? { historyRef } : {}),
    });
  } else {
    const errorMessages: string[] = [];
    if ('errors' in msg && Array.isArray(msg.errors)) {
      errorMessages.push(...(msg.errors as string[]));
    }
    const detail = errorMessages.length > 0 ? errorMessages.join('; ') : msg.subtype;
    events.push({
      type: 'error',
      message: `Session ended: ${detail}`,
    });
  }

  return events;
}
