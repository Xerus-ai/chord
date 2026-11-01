import type { GitAiAgent, GitAiAgentOutput, GitAiFailure } from '@shared/git-ai';

/** A Git AI run that cannot give the field a value; `failure` is what the UI shows. */
export class GitAiError extends Error {
  constructor(readonly failure: GitAiFailure) {
    super(failure.type === 'canceled' ? 'Generation was canceled' : failure.message);
    this.name = 'GitAiError';
  }
}

/** How much of the agent's output a failure carries. */
export const GIT_AI_OUTPUT_LIMIT = 8_000;
const HEAD_CHARS = 2_000;
const TAIL_CHARS = GIT_AI_OUTPUT_LIMIT - HEAD_CHARS;

const ANSI_SEQUENCE = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;

/**
 * The agent's output for display: colour codes and control characters gone
 * (lines and tabs kept), and bounded at both ends — CLIs put the reason first
 * or last, and a runaway answer must not flood the dialog or the IPC channel.
 */
export function boundAgentOutput(raw: string): GitAiAgentOutput {
  const text = raw
    .replace(ANSI_SEQUENCE, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\p{Cc}\p{Cf}]/gu, (character) =>
      character === '\n' || character === '\t' ? character : ''
    )
    .trim();
  if (text.length <= GIT_AI_OUTPUT_LIMIT) return { text, omittedChars: 0 };
  const omittedChars = text.length - GIT_AI_OUTPUT_LIMIT;
  return {
    text: `${text.slice(0, HEAD_CHARS)}\n… (${omittedChars} characters omitted) …\n${text.slice(
      text.length - TAIL_CHARS
    )}`,
    omittedChars,
  };
}

/** The bounded output, or null when the agent printed nothing. */
export function captureAgentOutput(...parts: string[]): GitAiAgentOutput | null {
  const joined = parts.filter((part) => part.trim()).join('\n');
  return joined.trim() ? boundAgentOutput(joined) : null;
}

export function agentFailed(
  agent: GitAiAgent,
  message: string,
  ...outputParts: string[]
): GitAiError {
  return new GitAiError({
    type: 'agent_failed',
    agent,
    message,
    output: captureAgentOutput(...outputParts),
  });
}
