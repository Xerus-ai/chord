import type { AccountInfo, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { getAgentDisplayName } from '@shared/agent-display-name';
import { getProvider } from '@shared/agent-providers';
import { gitAiTransport, type GitAiAgent, type GitAiAgentStatus } from '@shared/git-ai';
import { resolvePackagedClaudeExecutable } from '@main/core/claude-sdk/claude-executable-path';
import { CodexAppServerClient } from '@main/core/codex-app-server/app-server-client';
import type { GetAccountResponse } from '@main/core/codex-app-server/protocol/v2/GetAccountResponse';
import { resolveCommandPath } from '@main/core/dependencies/probe';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { connectAcpOneShot, openAcpOneShotSession } from './acp-one-shot';
import { withRunFolder } from './one-shot-run';

/** How long an ACP agent may take to open a session before it counts as unavailable. */
const ACP_START_TIMEOUT_MS = 30_000;

/**
 * Claude's own account report. An OAuth login carries the email; an API key
 * its source; a third-party provider (Bedrock, Vertex…) authenticates outside
 * Claude Code. With none of these, `tokenSource` is `none`.
 */
export function interpretClaudeAccount(info: AccountInfo): GitAiAgentStatus {
  const signedIn =
    (info.apiProvider !== undefined && info.apiProvider !== 'firstParty') ||
    !!info.email ||
    (!!info.apiKeySource && info.apiKeySource !== 'none') ||
    (!!info.tokenSource && info.tokenSource !== 'none');
  return signedIn
    ? { state: 'ready' }
    : {
        state: 'not_signed_in',
        message: 'Claude Code is not signed in. Run `claude` in a terminal and log in.',
      };
}

export function interpretCodexAccount(response: GetAccountResponse): GitAiAgentStatus {
  return response.account !== null || !response.requiresOpenaiAuth
    ? { state: 'ready' }
    : {
        state: 'not_signed_in',
        message: 'Codex is not signed in. Run `codex login` in a terminal.',
      };
}

/** A prompt stream that never yields: the CLI initializes and answers control requests. */
function idlePrompt(): AsyncIterable<SDKUserMessage> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: () => new Promise<IteratorResult<SDKUserMessage>>(() => {}),
    }),
  };
}

async function readClaudeStatus(): Promise<GitAiAgentStatus> {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  return withRunFolder(async (cwd) => {
    const q = query({
      prompt: idlePrompt(),
      // The same isolation as a run, so the check reads the login a run uses.
      options: {
        cwd,
        settingSources: [],
        persistSession: false,
        pathToClaudeCodeExecutable: resolvePackagedClaudeExecutable(),
      },
    });
    try {
      return interpretClaudeAccount(await q.accountInfo());
    } finally {
      q.close();
    }
  });
}

async function isOnPath(command: string): Promise<boolean> {
  return (await resolveCommandPath(command, new LocalExecutionContext())) !== null;
}

function notInstalled(agent: GitAiAgent, command: string): GitAiAgentStatus {
  return {
    state: 'not_installed',
    message: `${getAgentDisplayName(agent)} is not installed on this machine (no \`${command}\` on PATH).`,
  };
}

async function readCodexStatus(): Promise<GitAiAgentStatus> {
  const cli = getProvider('codex')?.cli ?? 'codex';
  const resolved = await resolveCommandPath(cli, new LocalExecutionContext());
  if (resolved === null) return notInstalled('codex', cli);
  return withRunFolder(async (cwd) =>
    interpretCodexAccount(
      await CodexAppServerClient.runOnce(resolved, cwd, (client) =>
        client.request<GetAccountResponse>('account/read', { refreshToken: false })
      )
    )
  );
}

async function readAcpStatus(agent: GitAiAgent): Promise<GitAiAgentStatus> {
  const bridge = getProvider(agent)?.acpConfig?.bridge;
  if (!bridge) throw new Error(`${agent} has no ACP bridge`);
  if (!(await isOnPath(bridge))) return notInstalled(agent, bridge);
  return withRunFolder(async (cwd) => {
    const acp = await connectAcpOneShot(agent, cwd);
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`no session after ${ACP_START_TIMEOUT_MS / 1000}s`)),
          ACP_START_TIMEOUT_MS
        );
      });
      const { session, canClose } = await Promise.race([openAcpOneShotSession(acp, cwd), timeout]);
      if (canClose) {
        await acp.connection.agent.request('session/close', { sessionId: session.sessionId });
      }
      session.dispose();
      return { state: 'ready' } as const;
    } catch (error) {
      const stderr = acp.readStderr().trim().split('\n').slice(-3).join(' ');
      return {
        state: 'unavailable',
        message: `${getAgentDisplayName(agent)} could not start a session: ${
          error instanceof Error ? error.message : String(error)
        }${stderr ? ` (${stderr})` : ''}`,
      } as const;
    } finally {
      clearTimeout(timer);
      await acp.stop();
    }
  });
}

/** Whether `agent` can run a Generate now; throws only on a bug or a broken check. */
export async function readGitAiAgentStatus(agent: GitAiAgent): Promise<GitAiAgentStatus> {
  switch (gitAiTransport(agent)) {
    case 'claude-sdk':
      return readClaudeStatus();
    case 'codex-app-server':
      return readCodexStatus();
    case 'acp':
      return readAcpStatus(agent);
  }
}
