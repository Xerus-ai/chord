import { describe, expect, it } from 'vitest';
import { describeGitAiFailure } from './describe-git-ai-failure';

/**
 * A failed Generate shows why and what the agent printed; a cancel shows
 * nothing. Either way the field keeps what the user had.
 */
describe('describeGitAiFailure', () => {
  it("names the agent and its reason, with the agent's output", () => {
    expect(
      describeGitAiFailure({
        type: 'agent_failed',
        agent: 'claude',
        message: 'There was an issue with the selected model (no-such-model).',
        output: { text: 'API Error: 404 model not found', omittedChars: 0 },
      })
    ).toEqual({
      reason: 'Claude Code failed: There was an issue with the selected model (no-such-model).',
      output: 'API Error: 404 model not found',
    });
  });

  it('says an answer could not be used, with the answer', () => {
    expect(
      describeGitAiFailure({
        type: 'unreadable_output',
        agent: 'codex',
        message: 'The answer is not JSON.',
        output: { text: 'Sure! Here is a title.', omittedChars: 0 },
      })
    ).toEqual({
      reason: "Codex's answer couldn't be used: The answer is not JSON.",
      output: 'Sure! Here is a title.',
    });
  });

  it('shows the message alone when there is no output', () => {
    expect(
      describeGitAiFailure({
        type: 'agent_not_installed',
        agent: 'codex',
        message: 'Codex is not installed on this machine.',
      })
    ).toEqual({ reason: 'Codex is not installed on this machine.', output: null });
    expect(
      describeGitAiFailure({ type: 'nothing_to_describe', message: 'There are no changes.' })
    ).toEqual({ reason: 'There are no changes.', output: null });
  });

  it('a not-signed-in failure keeps what the agent said', () => {
    expect(
      describeGitAiFailure({
        type: 'agent_not_signed_in',
        agent: 'claude',
        message: 'Claude Code is not signed in.',
        output: { text: 'Invalid API key · Please run /login', omittedChars: 0 },
      })
    ).toEqual({
      reason: 'Claude Code is not signed in.',
      output: 'Invalid API key · Please run /login',
    });
  });

  it('a cancel is not a failure to show', () => {
    expect(describeGitAiFailure({ type: 'canceled' })).toBeNull();
  });
});
