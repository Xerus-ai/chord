import { getAgentDisplayName } from '@shared/agent-display-name';
import type { GitAiFailure } from '@shared/git-ai';

export interface GitAiFailureView {
  reason: string;
  /** The agent's output (bounded in main), or null when it printed nothing. */
  output: string | null;
}

/** What a failed Generate shows under the field; a cancel shows nothing. */
export function describeGitAiFailure(failure: GitAiFailure): GitAiFailureView | null {
  switch (failure.type) {
    case 'canceled':
      return null;
    case 'nothing_to_describe':
    case 'agent_not_installed':
      return { reason: failure.message, output: null };
    case 'agent_not_signed_in':
      return { reason: failure.message, output: failure.output?.text ?? null };
    case 'agent_failed':
      return {
        reason: `${getAgentDisplayName(failure.agent)} failed: ${failure.message}`,
        output: failure.output?.text ?? null,
      };
    case 'unreadable_output':
      return {
        reason: `${getAgentDisplayName(failure.agent)}'s answer couldn't be used: ${failure.message}`,
        output: failure.output.text,
      };
  }
}
