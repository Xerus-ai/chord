import type {
  ContentBlock,
  InitializeResponse,
  SessionInfo,
  SessionUpdate,
  ToolCallContent,
  ToolCallLocation,
} from '@agentclientprotocol/sdk';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import type { ImportableSession } from '@shared/session-import';
import type { ToolContentBlock, ToolFileLocation } from '@shared/stream-items';
import { resolveAcpToolKind } from '@main/core/acp/acp-adapter';
import { comparablePath } from '@main/core/utils/comparable-path';
import type { AgentPathEnvironment } from '@main/utils/agent-reported-path';
import { IMAGE_MARKER } from './claude-transcript';
import { ImportTranscriptBuilder, type ImportedMessage } from './transcript-builder';

export interface AcpSessionSupport {
  canList: boolean;
  canLoad: boolean;
  /** How a later send continues the session: resume replays nothing; load replays it all. */
  continueWith: 'session/resume' | 'session/load' | null;
}

/** What an agent's `initialize` reply says it can do with sessions it did not start here. */
export function describeAcpSessionSupport(response: InitializeResponse): AcpSessionSupport {
  const capabilities = response.agentCapabilities;
  const canLoad = capabilities?.loadSession === true;
  const canResume = Boolean(capabilities?.sessionCapabilities?.resume);
  return {
    canList: Boolean(capabilities?.sessionCapabilities?.list),
    canLoad,
    continueWith: canResume ? 'session/resume' : canLoad ? 'session/load' : null,
  };
}

/** The lane's sessions Chord does not hold, as the agent listed them. */
export function selectImportableAcpSessions(
  providerId: AgentProviderId,
  sessions: SessionInfo[],
  lanePath: string,
  owned: ReadonlySet<string>,
  platform: NodeJS.Platform = process.platform
): ImportableSession[] {
  const lane = comparablePath(lanePath, platform);
  return sessions
    .filter(
      (session) => !owned.has(session.sessionId) && comparablePath(session.cwd, platform) === lane
    )
    .map((session) => ({
      providerId,
      providerSessionId: session.sessionId,
      title: session.title ?? null,
      lastActivityAt: session.updatedAt ? Date.parse(session.updatedAt) : null,
      cwd: lanePath,
    }));
}

/** A prompt or tool output's non-text part, as the chat can show it. */
function blockText(block: ContentBlock): string | null {
  switch (block.type) {
    case 'text':
      return block.text;
    case 'image':
      return IMAGE_MARKER;
    case 'resource_link':
      return block.uri;
    case 'resource':
      return block.resource.uri;
    default:
      return null;
  }
}

function toolContent(content: ToolCallContent[] | null | undefined): ToolContentBlock[] {
  return (content ?? []).flatMap((item): ToolContentBlock[] => {
    if (item.type === 'content') {
      const text = blockText(item.content);
      return text === null ? [] : [{ type: 'text', text }];
    }
    if (item.type === 'diff') {
      const removed = item.oldText ? item.oldText.split('\n').map((line) => `-${line}`) : [];
      const added = item.newText.split('\n').map((line) => `+${line}`);
      return [
        {
          type: 'diff',
          diff: [`--- ${item.path}`, `+++ ${item.path}`, ...removed, ...added].join('\n'),
        },
      ];
    }
    return [];
  });
}

function toolLocations(locations: ToolCallLocation[] | null | undefined): ToolFileLocation[] {
  return (locations ?? []).map((location) => ({
    filePath: location.path,
    ...(typeof location.line === 'number' ? { startLine: location.line } : {}),
  }));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Replay order as time, for a replay that carries none: row i of n is at
 * `lastActivityAt` less (n - 1 - i) seconds. The chat orders rows by second,
 * prompts first within one, so rows sharing a time showed every prompt before
 * every reply.
 */
function stampInReplayOrder(
  messages: ImportedMessage[],
  lastActivityAt: number
): ImportedMessage[] {
  return messages.map((message, index) => {
    const at = lastActivityAt - (messages.length - 1 - index) * 1000;
    if (message.kind === 'human') return { ...message, createdAt: at };
    return {
      ...message,
      items: message.items.map((item) =>
        item.kind === 'thinking' ? { ...item, startedAt: at } : item
      ),
      startedAt: at,
      completedAt: at,
    };
  });
}

/**
 * A `session/load` replay as chat rows. ACP updates carry no times, so the
 * rows keep replay order a second apart, the last at `at` (the session's last
 * activity). Chunks are deltas: consecutive user chunks are one prompt, and a
 * new agent message id opens a paragraph, as the live ACP path does.
 */
export function buildAcpImportMessages(
  updates: SessionUpdate[],
  at: number,
  cwd: string,
  environment?: AgentPathEnvironment
): ImportedMessage[] {
  const builder = new ImportTranscriptBuilder(cwd, environment);
  let prompt: string[] | null = null;
  let promptTextOpen = false;
  let agentMessageId: string | null = null;

  const flushPrompt = () => {
    if (prompt === null) return;
    builder.prompt(prompt.join('\n\n'), at);
    prompt = null;
    agentMessageId = null;
  };

  for (const update of updates) {
    if (update.sessionUpdate === 'user_message_chunk') {
      const parts: string[] = prompt ?? [];
      prompt = parts;
      const text = blockText(update.content);
      if (text === null) continue;
      if (update.content.type === 'text' && promptTextOpen && parts.length > 0) {
        parts[parts.length - 1] += text;
      } else {
        parts.push(text);
      }
      promptTextOpen = update.content.type === 'text';
      continue;
    }
    flushPrompt();
    promptTextOpen = false;

    switch (update.sessionUpdate) {
      case 'agent_message_chunk': {
        if (update.content.type !== 'text') break;
        const messageId = update.messageId ?? null;
        if (messageId !== null && agentMessageId !== null && messageId !== agentMessageId) {
          builder.openTextBlock();
        }
        if (messageId !== null) agentMessageId = messageId;
        if (update.content.text) builder.appendText(update.content.text, at);
        else builder.openTextBlock();
        break;
      }
      case 'agent_thought_chunk':
        if (update.content.type === 'text') builder.thinking(update.content.text, at);
        break;
      case 'tool_call':
        builder.toolCall(
          {
            callId: update.toolCallId,
            name: update.title,
            kind: resolveAcpToolKind(update.kind, update.title),
            status: update.status ?? 'pending',
            rawInput: asRecord(update.rawInput),
            locations: toolLocations(update.locations),
            contentBlocks: toolContent(update.content),
          },
          at
        );
        break;
      case 'tool_call_update':
        builder.toolUpdate(
          update.toolCallId,
          {
            status: update.status ?? undefined,
            rawInput: asRecord(update.rawInput),
            contentBlocks: toolContent(update.content),
          },
          at
        );
        break;
      default:
        break;
    }
  }
  flushPrompt();
  return stampInReplayOrder(builder.finish(), at);
}
