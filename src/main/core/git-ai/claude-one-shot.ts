import { resolvePackagedClaudeExecutable } from '@main/core/claude-sdk/claude-executable-path';
import { agentFailed, captureAgentOutput, GitAiError } from './git-ai-errors';
import { GIT_AI_SYSTEM_PROMPT } from './git-ai-prompts';
import { withRunFolder, type OneShotRequest } from './one-shot-run';

/** The fields of the SDK's stream messages a one-shot reads (sdk.d.ts 0.3.265). */
export interface ClaudeOneShotMessage {
  type: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  errors?: string[];
  error?: string;
  message?: { content?: ReadonlyArray<{ type: string; text?: string }> };
}

const SIGNED_OUT_ERRORS = new Set(['authentication_failed', 'oauth_org_not_allowed']);
const NOT_SIGNED_IN =
  'Claude Code is not signed in. Run `claude` in a terminal and log in, then try again.';

function assistantText(messages: readonly ClaudeOneShotMessage[]): string {
  return messages
    .filter((message) => message.type === 'assistant')
    .flatMap((message) => message.message?.content ?? [])
    .map((block) => (block.type === 'text' ? (block.text ?? '') : ''))
    .join('');
}

/** The answer of one tool-less query, or the typed failure its messages describe. */
export function readClaudeOneShotResult(
  messages: readonly ClaudeOneShotMessage[],
  stderr: string
): string {
  const said = assistantText(messages);
  const result = [...messages].reverse().find((message) => message.type === 'result');
  if (
    messages.some(
      (message) => message.type === 'assistant' && SIGNED_OUT_ERRORS.has(message.error ?? '')
    )
  ) {
    throw new GitAiError({
      type: 'agent_not_signed_in',
      agent: 'claude',
      message: NOT_SIGNED_IN,
      output: captureAgentOutput(said || (result?.result ?? ''), stderr),
    });
  }
  if (!result) throw agentFailed('claude', 'Claude Code ended without an answer.', said, stderr);
  if (result.subtype !== 'success') {
    const errors = result.errors?.length ? `: ${result.errors.join('; ')}` : '';
    throw agentFailed('claude', `Claude Code stopped (${result.subtype})${errors}`, said, stderr);
  }
  const text = result.result ?? '';
  if (result.is_error) {
    throw agentFailed('claude', text.trim() || 'Claude Code reported an error.', said, stderr);
  }
  if (!text.trim()) throw agentFailed('claude', 'Claude Code returned an empty answer.', stderr);
  return text;
}

/**
 * One prompt through the user's Claude Code, with nothing else: no tools, no
 * settings files (so no hooks, plugins or MCP servers of theirs run), no MCP
 * servers, a Git AI system prompt instead of Claude Code's, one turn, in an
 * empty folder, and no session written to ~/.claude/projects.
 */
export async function runClaudeOneShot(request: OneShotRequest): Promise<string> {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  return withRunFolder(async (cwd) => {
    const abortController = new AbortController();
    const abort = () => abortController.abort();
    request.signal.addEventListener('abort', abort, { once: true });
    let stderr = '';
    const messages: ClaudeOneShotMessage[] = [];
    try {
      const q = query({
        prompt: request.prompt,
        options: {
          cwd,
          model: request.model ?? undefined,
          systemPrompt: GIT_AI_SYSTEM_PROMPT,
          tools: [],
          allowedTools: [],
          permissionMode: 'dontAsk',
          settingSources: [],
          strictMcpConfig: true,
          mcpServers: {},
          hooks: {},
          persistSession: false,
          maxTurns: 1,
          pathToClaudeCodeExecutable: resolvePackagedClaudeExecutable(),
          abortController,
          stderr: (data) => {
            stderr += data;
          },
        },
      });
      for await (const message of q) messages.push(message as ClaudeOneShotMessage);
    } catch (error) {
      if (request.signal.aborted) throw new GitAiError({ type: 'canceled' });
      // After an error result the SDK also throws for the CLI's exit, wrapping
      // the same text; the result message is the one that says why.
      if (!messages.some((message) => message.type === 'result')) {
        throw agentFailed(
          'claude',
          error instanceof Error ? error.message : String(error),
          assistantText(messages),
          stderr
        );
      }
    } finally {
      request.signal.removeEventListener('abort', abort);
    }
    if (request.signal.aborted) throw new GitAiError({ type: 'canceled' });
    return readClaudeOneShotResult(messages, stderr);
  });
}
