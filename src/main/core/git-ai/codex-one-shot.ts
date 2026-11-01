import { getProvider } from '@shared/agent-providers';
import { resolveAgentExecutable } from '@main/core/agent-sessions/resolve-agent-executable';
import { CodexAppServerClient } from '@main/core/codex-app-server/app-server-client';
import {
  resolveCodexHomeKey,
  waitForCodexShutdowns,
} from '@main/core/codex-app-server/codex-shutdown-registry';
import type { ThreadItem } from '@main/core/codex-app-server/protocol/v2/ThreadItem';
import type { ThreadStartParams } from '@main/core/codex-app-server/protocol/v2/ThreadStartParams';
import type { ThreadStartResponse } from '@main/core/codex-app-server/protocol/v2/ThreadStartResponse';
import type { Turn } from '@main/core/codex-app-server/protocol/v2/Turn';
import type { TurnInterruptParams } from '@main/core/codex-app-server/protocol/v2/TurnInterruptParams';
import type { TurnStartParams } from '@main/core/codex-app-server/protocol/v2/TurnStartParams';
import type { TurnStartResponse } from '@main/core/codex-app-server/protocol/v2/TurnStartResponse';
import type { TurnStatus } from '@main/core/codex-app-server/protocol/v2/TurnStatus';
import { agentFailed, captureAgentOutput, GitAiError } from './git-ai-errors';
import { GIT_AI_SYSTEM_PROMPT } from './git-ai-prompts';
import { withRunFolder, type OneShotRequest } from './one-shot-run';

const SHUTDOWN_WAIT_MS = 15_000;

const NOT_SIGNED_IN = 'Codex is not signed in. Run `codex login` in a terminal, then try again.';

/** The answer of one ephemeral turn, or the typed failure the turn describes. */
export function readCodexOneShotResult(args: {
  turn: {
    status: TurnStatus;
    /** `TurnError`'s fields this reads; `codexErrorInfo` is compared, never trusted. */
    error: { message: string; codexErrorInfo: unknown; additionalDetails: string | null } | null;
  };
  agentText: string;
  stderr: string;
}): string {
  const { turn, agentText, stderr } = args;
  if (turn.status === 'interrupted') throw new GitAiError({ type: 'canceled' });
  if (turn.status === 'failed') {
    const error = turn.error;
    if (error?.codexErrorInfo === 'unauthorized') {
      throw new GitAiError({
        type: 'agent_not_signed_in',
        agent: 'codex',
        message: NOT_SIGNED_IN,
        output: captureAgentOutput(error.message, stderr),
      });
    }
    const message = error
      ? [error.message, error.additionalDetails].filter(Boolean).join(' ')
      : 'The Codex turn failed.';
    throw agentFailed('codex', message, agentText, stderr);
  }
  if (turn.status !== 'completed') {
    throw agentFailed('codex', `The Codex turn ended ${turn.status}.`, agentText, stderr);
  }
  if (!agentText.trim()) throw agentFailed('codex', 'Codex returned an empty answer.', stderr);
  return agentText;
}

function isMissingExecutable(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/**
 * One prompt on an ephemeral Codex thread (never written to its history), in
 * an empty folder, read-only, with no environment to run commands in and
 * every server request refused — so the turn is text only.
 */
export async function runCodexOneShot(request: OneShotRequest): Promise<string> {
  const command = await resolveAgentExecutable({
    providerId: 'codex',
    cli: getProvider('codex')?.cli,
  });
  return withRunFolder(async (cwd) => {
    let stderr = '';
    let finalText = '';
    let settle: { resolve: (turn: Turn) => void; reject: (error: Error) => void } | null = null;
    const completed = new Promise<Turn>((resolve, reject) => {
      settle = { resolve, reject };
    });
    let client: CodexAppServerClient | null = null;
    try {
      client = await CodexAppServerClient.start({
        command,
        cwd,
        handlers: {
          onNotification: (method, params) => {
            if (method === 'item/completed') {
              const { item } = params as { item: ThreadItem };
              if (item.type === 'agentMessage' && item.phase !== 'commentary')
                finalText = item.text;
            } else if (method === 'turn/completed') {
              settle?.resolve((params as { turn: Turn }).turn);
            }
          },
          onServerRequest: (id, method) =>
            client?.respondError(id, -32601, `Git AI runs without tools (${method})`),
          onStderr: (text) => {
            stderr += text;
          },
          onError: (error) => settle?.reject(error),
          onExit: (code) => settle?.reject(new Error(`codex app-server exited (code ${code})`)),
        },
      });
      const { thread } = await client.request<ThreadStartResponse>('thread/start', {
        cwd,
        model: request.model,
        ephemeral: true,
        sandbox: 'read-only',
        approvalPolicy: 'never',
        environments: [],
        developerInstructions: GIT_AI_SYSTEM_PROMPT,
      } satisfies ThreadStartParams);
      const { turn } = await client.request<TurnStartResponse>('turn/start', {
        threadId: thread.id,
        input: [{ type: 'text', text: request.prompt, text_elements: [] }],
      } satisfies TurnStartParams);
      const interrupt = () =>
        void client?.request('turn/interrupt', {
          threadId: thread.id,
          turnId: turn.id,
        } satisfies TurnInterruptParams);
      request.signal.addEventListener('abort', interrupt, { once: true });
      if (request.signal.aborted) interrupt();
      const ended = await completed;
      request.signal.removeEventListener('abort', interrupt);
      return readCodexOneShotResult({ turn: ended, agentText: finalText, stderr });
    } catch (error) {
      if (error instanceof GitAiError) throw error;
      if (request.signal.aborted) throw new GitAiError({ type: 'canceled' });
      if (isMissingExecutable(error)) {
        throw new GitAiError({
          type: 'agent_not_installed',
          agent: 'codex',
          message: `Codex is not installed on this machine (${command} was not found).`,
        });
      }
      throw agentFailed('codex', (error as Error).message, finalText, stderr);
    } finally {
      client?.close();
      // The server runs in the run folder; it must be gone before the folder is removed.
      await waitForCodexShutdowns(resolveCodexHomeKey(process.env), SHUTDOWN_WAIT_MS);
    }
  });
}
