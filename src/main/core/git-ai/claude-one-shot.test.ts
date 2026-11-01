import { describe, expect, it } from 'vitest';
import { readClaudeOneShotResult } from './claude-one-shot';
import { GitAiError } from './git-ai-errors';

/**
 * The messages one tool-less Claude query streams, read into the answer or a
 * typed failure. Shapes are the SDK's own (`SDKAssistantMessage`,
 * `SDKResultMessage`, sdk.d.ts 0.3.265).
 */

const assistantText = (text: string, error?: string) => ({
  type: 'assistant' as const,
  ...(error ? { error } : {}),
  message: { content: [{ type: 'text', text }] },
});

const success = (result: string, isError = false) => ({
  type: 'result' as const,
  subtype: 'success',
  is_error: isError,
  result,
});

function failureOf(run: () => unknown) {
  try {
    run();
  } catch (error) {
    if (error instanceof GitAiError) return error.failure;
    throw error;
  }
  throw new Error('expected a GitAiError');
}

describe('readClaudeOneShotResult', () => {
  it("is the result message's text", () => {
    const messages = [
      { type: 'system', subtype: 'init' },
      assistantText('Redirect to the dashboard after login'),
      success('Redirect to the dashboard after login'),
    ];
    expect(readClaudeOneShotResult(messages, '')).toBe('Redirect to the dashboard after login');
  });

  it('an authentication error names Claude as not signed in, with what it said', () => {
    const failure = failureOf(() =>
      readClaudeOneShotResult(
        [
          assistantText('Invalid API key · Please run /login', 'authentication_failed'),
          success('Invalid API key · Please run /login', true),
        ],
        ''
      )
    );
    expect(failure).toMatchObject({ type: 'agent_not_signed_in', agent: 'claude' });
    expect(failure.type === 'agent_not_signed_in' && failure.output?.text).toContain(
      'Please run /login'
    );
  });

  it('an API error result is a failure carrying its text', () => {
    const failure = failureOf(() =>
      readClaudeOneShotResult(
        [
          assistantText(
            'There was an issue with the selected model (no-such-model).',
            'model_not_found'
          ),
          success('There was an issue with the selected model (no-such-model).', true),
        ],
        ''
      )
    );
    expect(failure).toMatchObject({ type: 'agent_failed', agent: 'claude' });
    expect(failure.type === 'agent_failed' && failure.message).toContain('no-such-model');
  });

  it('an error result subtype is a failure naming why it stopped', () => {
    const failure = failureOf(() =>
      readClaudeOneShotResult(
        [
          {
            type: 'result',
            subtype: 'error_during_execution',
            is_error: true,
            errors: ['process exited'],
          },
        ],
        'stderr line'
      )
    );
    expect(failure).toMatchObject({ type: 'agent_failed', agent: 'claude' });
    expect(failure.type === 'agent_failed' && failure.message).toContain('error_during_execution');
    expect(failure.type === 'agent_failed' && failure.output?.text).toContain('stderr line');
  });

  it('an empty answer is a failure, not an empty message', () => {
    expect(failureOf(() => readClaudeOneShotResult([success('   ')], ''))).toMatchObject({
      type: 'agent_failed',
      agent: 'claude',
    });
  });

  it('a stream that ends with no result is a failure carrying stderr', () => {
    const failure = failureOf(() =>
      readClaudeOneShotResult([{ type: 'system', subtype: 'init' }], 'claude: spawn failed')
    );
    expect(failure).toMatchObject({ type: 'agent_failed', agent: 'claude' });
    expect(failure.type === 'agent_failed' && failure.output?.text).toContain('spawn failed');
  });
});
