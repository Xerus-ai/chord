import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentOutputEvent } from '@shared/events/agentOutputEvents';
import { mapClaudeRateLimitWindows } from '@shared/session-telemetry';
import { log } from '@main/lib/logger';
import { translateResultMessage, translateSystemMessage } from './sdk-system-messages';

/** The tool-card kind for a Claude tool name; the transcript importer uses the same. */
export function inferToolKind(name: string): string {
  const lower = name.toLowerCase();
  if (/read|cat|^ls$|head|tail|view|notebook|jupyter/.test(lower)) return 'read';
  if (/edit|write|multiedit|patch|replace|insert/.test(lower)) return 'edit';
  if (/glob|grep|search|find|^rg$|locate/.test(lower)) return 'search';
  if (/fetch|web|url|http|curl/.test(lower)) return 'fetch';
  if (/agent|spawn|delegate|subagent/.test(lower)) return 'agent';
  if (/bash|exec|command|shell|run|terminal|powershell/.test(lower)) return 'execute';
  if (/task|todo|plan/.test(lower)) return 'task';
  return 'execute';
}

// With includePartialMessages enabled the SDK delivers assistant output twice:
// live `stream_event` deltas while generating, then the assembled `assistant`
// message. Emitting both duplicates every paragraph, so the translator keeps
// per-message watermarks (text streamed so far) and emits only the unemitted
// suffix when the final message arrives.
interface StreamLane {
  apiMessageId: string | null;
  text: string;
  thinking: string;
}

interface TranslatorState {
  lanes: Map<string, StreamLane>;
  finalizedMessageKeys: Set<string>;
  /**
   * The uuid of the newest main-chain `assistant` or `user` message: the
   * transcript entry a turn ends on, reported as its history ref
   * (`forkSession`'s `upToMessageId`). A subagent's messages live in its own
   * transcript, so they never move it.
   */
  lastHistoryRef: string | null;
}

export function createSDKMessageTranslator(): (msg: SDKMessage) => AgentOutputEvent[] {
  const state: TranslatorState = {
    lanes: new Map(),
    finalizedMessageKeys: new Set(),
    lastHistoryRef: null,
  };
  return (msg) => translateSDKMessage(state, msg);
}

function laneKey(msg: { parent_tool_use_id?: string | null }): string {
  return msg.parent_tool_use_id ?? 'main';
}

function translateSDKMessage(state: TranslatorState, msg: SDKMessage): AgentOutputEvent[] {
  switch (msg.type) {
    // A subagent's own transcript (parent_tool_use_id set) reports through its
    // parent Task call only — its results already route there. Emitting its
    // text and tool_use blocks as the main agent's put inner calls in the
    // stream that nothing ever completes (they spun as "Working" after the
    // turn ended) and duplicated the subagent's report as main-agent prose.
    case 'assistant':
      if (msg.parent_tool_use_id) return [];
      recordHistoryRef(state, msg.uuid);
      return translateAssistantMessage(state, msg);

    case 'user':
      if (!msg.parent_tool_use_id) recordHistoryRef(state, msg.uuid);
      return translateUserMessage(msg);

    case 'stream_event':
      if (msg.parent_tool_use_id) return [];
      return translateStreamEvent(state, msg);

    case 'tool_progress':
      return [
        {
          type: 'tool_call_update',
          callId: msg.tool_use_id,
          status: 'in_progress',
        },
      ];

    case 'result':
      return translateResultMessage(msg, state.lastHistoryRef ?? undefined);

    case 'system':
      return translateSystemMessage(msg);

    case 'rate_limit_event': {
      const windows = mapClaudeRateLimitWindows(msg.rate_limit_info);
      return windows.length > 0 ? [{ type: 'rate_limit', windows }] : [];
    }

    default:
      return [];
  }
}

function recordHistoryRef(state: TranslatorState, uuid: unknown): void {
  if (typeof uuid === 'string' && uuid) state.lastHistoryRef = uuid;
}

function getOrCreateLane(state: TranslatorState, key: string): StreamLane {
  let lane = state.lanes.get(key);
  if (!lane) {
    lane = { apiMessageId: null, text: '', thinking: '' };
    state.lanes.set(key, lane);
  }
  return lane;
}

function translateStreamEvent(
  state: TranslatorState,
  msg: Extract<SDKMessage, { type: 'stream_event' }>
): AgentOutputEvent[] {
  const event = msg.event;
  if (!event || !('type' in event)) return [];

  switch (event.type) {
    case 'message_start': {
      const apiMessageId =
        'message' in event && event.message && typeof event.message.id === 'string'
          ? event.message.id
          : null;
      state.lanes.set(laneKey(msg), { apiMessageId, text: '', thinking: '' });
      return [];
    }
    case 'content_block_start': {
      const block = 'content_block' in event ? event.content_block : null;
      return block?.type === 'text' ? [{ type: 'text_block_start' }] : [];
    }
    case 'content_block_delta': {
      const delta = event.delta;
      if (!delta) return [];
      const lane = getOrCreateLane(state, laneKey(msg));
      if (delta.type === 'text_delta' && 'text' in delta) {
        lane.text += delta.text;
        return [{ type: 'text', text: delta.text }];
      }
      if (delta.type === 'thinking_delta' && 'thinking' in delta) {
        lane.thinking += delta.thinking;
        return [{ type: 'reasoning', text: delta.thinking }];
      }
      return [];
    }
    default:
      return [];
  }
}

// Emits the portion of `absolute` not already streamed via deltas. `streamed`
// is always a prefix of `absolute` for a well-behaved stream; a mismatch means
// deltas diverged from the assembled message, in which case the full text is
// emitted so nothing is lost (duplication is impossible only when prefixes hold).
function unemittedSuffix(absolute: string, streamed: string, kind: string): string {
  if (absolute.length === 0) return '';
  if (absolute.startsWith(streamed)) {
    return absolute.slice(streamed.length);
  }
  log.warn('sdk-message-translator: stream deltas diverged from final message', { kind });
  return absolute;
}

function translateAssistantMessage(
  state: TranslatorState,
  msg: Extract<SDKMessage, { type: 'assistant' }>
): AgentOutputEvent[] {
  const apiMessageId = typeof msg.message.id === 'string' ? msg.message.id : null;
  // Dedupe by SDK message uuid, NOT api message id: the SDK delivers one
  // assistant message per content block, so a thinking block and a tool_use
  // block of the same API message arrive as separate assistant messages
  // sharing message.id. Keying on message.id drops every block after the
  // first — tool calls vanish. A true replay reuses the same uuid.
  const dedupeKey = typeof msg.uuid === 'string' ? msg.uuid : apiMessageId;
  if (dedupeKey && state.finalizedMessageKeys.has(dedupeKey)) {
    return [];
  }

  const key = laneKey(msg);
  const lane = state.lanes.get(key);
  const laneMatches =
    lane !== undefined && (lane.apiMessageId === null || lane.apiMessageId === apiMessageId);
  const streamedText = laneMatches ? lane.text : '';
  const streamedThinking = laneMatches ? lane.thinking : '';

  let absoluteText = '';
  let absoluteThinking = '';
  for (const block of msg.message.content) {
    if (block.type === 'text') absoluteText += block.text;
    if (block.type === 'thinking' && 'thinking' in block) absoluteThinking += block.thinking;
  }

  const events: AgentOutputEvent[] = [];

  const thinkingSuffix = unemittedSuffix(absoluteThinking, streamedThinking, 'thinking');
  if (thinkingSuffix) {
    events.push({ type: 'reasoning', text: thinkingSuffix });
  }

  const textSuffix = unemittedSuffix(absoluteText, streamedText, 'text');
  if (textSuffix) {
    events.push({ type: 'text', text: textSuffix, messageId: msg.uuid });
  }

  for (const block of msg.message.content) {
    if (block.type === 'tool_use') {
      events.push({
        type: 'tool_call',
        callId: block.id,
        name: block.name,
        status: 'in_progress',
        kind: inferToolKind(block.name),
        rawInput: block.input as Record<string, unknown> | undefined,
      });
    }
  }

  if (msg.error) {
    events.push({ type: 'error', message: `Assistant error: ${msg.error}` });
  }

  if (dedupeKey) {
    state.finalizedMessageKeys.add(dedupeKey);
  }
  if (laneMatches) {
    state.lanes.delete(key);
  }

  return events;
}

// Main-agent tool results carry parent_tool_use_id null (it is only set for
// results produced inside a subagent transcript, where it names the parent
// Task call). The call a main-agent result answers is identified by the
// tool_result block's tool_use_id.
function extractToolUseId(message: { content?: unknown }): string | null {
  if (!Array.isArray(message.content)) return null;
  for (const block of message.content) {
    if (typeof block === 'object' && block !== null) {
      const b = block as Record<string, unknown>;
      if (b.type === 'tool_result' && typeof b.tool_use_id === 'string') {
        return b.tool_use_id;
      }
    }
  }
  return null;
}

function translateUserMessage(msg: Extract<SDKMessage, { type: 'user' }>): AgentOutputEvent[] {
  if (!msg.tool_use_result) return [];

  const callId = msg.parent_tool_use_id ?? extractToolUseId(msg.message);
  if (!callId) return [];

  const result = msg.tool_use_result as {
    type?: string;
    content?: unknown;
    is_error?: boolean;
    output?: string;
    plan?: string | null;
  };
  const isError = result.is_error === true;

  const events: AgentOutputEvent[] = [];

  const content = extractToolResultContent(result);

  events.push({
    type: 'tool_call_update',
    callId,
    status: isError ? 'failed' : 'completed',
    content: content.length > 0 ? content : undefined,
  });

  const planText = extractPlanFromResult(result);
  if (!isError && planText) {
    const planEntries = parsePlanText(planText);
    if (planEntries.length > 0) {
      events.push({ type: 'plan', entries: planEntries });
    }
  }

  return events;
}

function extractPlanFromResult(result: Record<string, unknown>): string | null {
  if (typeof result.plan === 'string' && result.plan) return result.plan;

  if (Array.isArray(result.content)) {
    for (const item of result.content) {
      if (typeof item === 'object' && item !== null) {
        const c = item as Record<string, unknown>;
        if (typeof c.plan === 'string' && c.plan) return c.plan;
        if (c.type === 'text' && typeof c.text === 'string') {
          try {
            const parsed = JSON.parse(c.text) as Record<string, unknown>;
            if (typeof parsed.plan === 'string' && parsed.plan) return parsed.plan;
          } catch {
            // not JSON
          }
        }
      }
    }
  }

  return null;
}

export function parsePlanText(planText: string): Array<{ text: string; status: string }> {
  const entries: Array<{ text: string; status: string }> = [];
  const lines = planText.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(/^(?:\d+[.)]\s*|-\s*(?:\[[ x]\]\s*)?|\*\s*)(.+)/);
    if (match && match[1]) {
      const isCompleted = trimmed.includes('[x]') || trimmed.includes('[X]');
      entries.push({ text: match[1].trim(), status: isCompleted ? 'completed' : 'pending' });
    }
  }
  if (entries.length === 0 && planText.trim().length > 0) {
    entries.push({ text: planText.trim().slice(0, 200), status: 'pending' });
  }
  return entries;
}

function extractToolResultContent(
  result: Record<string, unknown>
): Array<{ type: 'text' | 'diff'; text?: string; diff?: string }> {
  const blocks: Array<{ type: 'text' | 'diff'; text?: string; diff?: string }> = [];

  if (typeof result.output === 'string' && result.output) {
    blocks.push({ type: 'text', text: result.output });
  }

  if (Array.isArray(result.content)) {
    for (const item of result.content) {
      if (typeof item === 'object' && item !== null) {
        const c = item as Record<string, unknown>;
        if (c.type === 'text' && typeof c.text === 'string') {
          blocks.push({ type: 'text', text: c.text });
        }
      }
    }
  }

  return blocks;
}
