import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { buildClaudeCatalog, type AgentControlCatalog } from '@shared/agent-control-catalog';
import { resolvePackagedClaudeExecutable } from '@main/core/claude-sdk/claude-executable-path';

/** A prompt stream that never yields: the CLI initializes and waits, no turn runs. */
function idlePrompt(): AsyncIterable<SDKUserMessage> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: () => new Promise<IteratorResult<SDKUserMessage>>(() => {}),
    }),
  };
}

/**
 * Asks the installed Claude Code for its model list — the same rows its own
 * `/model` picker shows, with each model's effort levels and fast-mode
 * support, including models the user added in their settings. Spawning the
 * CLI is the only source that stays current as Claude Code ships new models;
 * the list it answers with is what a launch will actually accept.
 */
export async function probeClaudeCatalog(cwd: string): Promise<AgentControlCatalog> {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  const q = query({
    prompt: idlePrompt(),
    options: { cwd, pathToClaudeCodeExecutable: resolvePackagedClaudeExecutable() },
  });
  try {
    return buildClaudeCatalog(await q.supportedModels());
  } finally {
    q.close();
  }
}
