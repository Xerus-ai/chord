import { describe, expect, it } from 'vitest';
import { readCodexOneShotResult } from './codex-one-shot';
import { GitAiError } from './git-ai-errors';

/**
 * One ephemeral Codex turn, read into the answer or a typed failure. The turn
 * shape is the app-server's `turn/completed` (`protocol/v2/Turn.ts`); the
 * answer is the text of its `agentMessage` items.
 */

function failureOf(run: () => unknown) {
  try {
    run();
  } catch (error) {
    if (error instanceof GitAiError) return error.failure;
    throw error;
  }
  throw new Error('expected a GitAiError');
}

const turnError = (message: string, codexErrorInfo: unknown) => ({
  message,
  codexErrorInfo,
  additionalDetails: null,
  misalignment: null,
});

describe('readCodexOneShotResult', () => {
  it("is the turn's agent text when it completed", () => {
    expect(
      readCodexOneShotResult({
        turn: { status: 'completed', error: null },
        agentText: 'Redirect to the dashboard after login\n',
        stderr: '',
      })
    ).toBe('Redirect to the dashboard after login\n');
  });

  it('an unauthorized turn names Codex as not signed in', () => {
    const failure = failureOf(() =>
      readCodexOneShotResult({
        turn: { status: 'failed', error: turnError('401 Unauthorized', 'unauthorized') },
        agentText: '',
        stderr: '',
      })
    );
    expect(failure).toMatchObject({ type: 'agent_not_signed_in', agent: 'codex' });
  });

  it('a failed turn is a failure carrying its message — a usage limit included', () => {
    const failure = failureOf(() =>
      readCodexOneShotResult({
        turn: {
          status: 'failed',
          error: turnError(
            "You've hit your usage limit. Try again at 00:41.",
            'usageLimitExceeded'
          ),
        },
        agentText: '',
        stderr: 'warn: retrying',
      })
    );
    expect(failure).toMatchObject({ type: 'agent_failed', agent: 'codex' });
    expect(failure.type === 'agent_failed' && failure.message).toContain('usage limit');
    expect(failure.type === 'agent_failed' && failure.output?.text).toContain('retrying');
  });

  it('an interrupted turn is a cancel', () => {
    expect(
      failureOf(() =>
        readCodexOneShotResult({
          turn: { status: 'interrupted', error: null },
          agentText: 'Redir',
          stderr: '',
        })
      )
    ).toEqual({ type: 'canceled' });
  });

  it('a completed turn with no text is a failure, not an empty message', () => {
    expect(
      failureOf(() =>
        readCodexOneShotResult({
          turn: { status: 'completed', error: null },
          agentText: '  ',
          stderr: '',
        })
      )
    ).toMatchObject({ type: 'agent_failed', agent: 'codex' });
  });
});
