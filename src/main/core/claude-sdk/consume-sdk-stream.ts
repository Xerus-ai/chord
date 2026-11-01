import type { PermissionMode, Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentOutputEvent } from '@shared/events/agentOutputEvents';
import { CHORD_MCP_SERVER_NAME } from '@main/core/agent-artifact-tools/chord-server-name';
import { log } from '@main/lib/logger';
import { createSDKMessageTranslator } from './sdk-message-translator';

/** Where a session's SDK stream reports to: its callbacks and its abort signal. */
export interface SdkStreamSink {
  abortController: AbortController;
  onEvent: (event: AgentOutputEvent) => void;
  onSessionId: (externalSessionId: string) => void;
  onPermissionMode: (mode: PermissionMode) => void;
  onExit: (code: number) => void;
}

export async function consumeStream(q: Query, opts: SdkStreamSink): Promise<void> {
  const translate = createSDKMessageTranslator();
  let reportedSessionId: string | undefined;

  for await (const msg of q) {
    if (opts.abortController.signal.aborted) break;

    const sessionId = extractSessionId(msg);
    if (sessionId && sessionId !== reportedSessionId) {
      reportedSessionId = sessionId;
      opts.onSessionId(sessionId);
    }

    if (msg.type === 'system' && msg.subtype === 'init') logArtifactPublishingTools(msg.tools);
    if (msg.type === 'system' && (msg.subtype === 'init' || msg.subtype === 'status')) {
      if (msg.permissionMode) opts.onPermissionMode(msg.permissionMode);
    }

    const events = translate(msg);
    for (const event of events) {
      opts.onEvent(event);
    }

    // The context ring's reading: once the CLI is up (system prompt, tools and
    // memory already count) and again after every turn.
    if ((msg.type === 'system' && msg.subtype === 'init') || msg.type === 'result') {
      void reportContextUsage(q, opts);
    }
  }

  opts.onExit(0);
}

/**
 * Which publish paths the session actually got: Chord's `mcp__chord__*` tools
 * and Claude Code's built-in Artifact tool. The two are meant to be exclusive
 * (`buildClaudeFlagSettings`), and the CLI's own tool list is the only place
 * that shows whether they were.
 */
function logArtifactPublishingTools(tools: string[]): void {
  log.info('claude-sdk-session: artifact publishing tools', {
    chordTools: tools.filter((name) => name.startsWith(`mcp__${CHORD_MCP_SERVER_NAME}__`)),
    builtInArtifactTool: tools.some((name) => name.toLowerCase() === 'artifact'),
  });
}

/**
 * `summary` answers from the last response's usage without token-count calls.
 * A failed read leaves the ring on its previous value; it is logged, never
 * papered over with an estimate.
 */
async function reportContextUsage(q: Query, opts: SdkStreamSink): Promise<void> {
  try {
    const usage = await q.getContextUsage({ detail: 'summary' });
    if (opts.abortController.signal.aborted) return;
    opts.onEvent({
      type: 'context_usage',
      usedTokens: usage.totalTokens,
      maxTokens: usage.maxTokens,
    });
  } catch (e) {
    log.warn('claude-sdk-session: context usage read failed', { error: String(e) });
  }
}

function extractSessionId(msg: SDKMessage): string | undefined {
  if ('session_id' in msg && typeof msg.session_id === 'string') {
    return msg.session_id;
  }
  return undefined;
}
