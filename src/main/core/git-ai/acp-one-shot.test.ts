import { describe, expect, it } from 'vitest';
import { acpCanCloseSession, readAcpOneShotResult } from './acp-one-shot';
import { GitAiError } from './git-ai-errors';

/**
 * One prompt on an ACP agent (`session/new` in an empty temp folder, no MCP
 * servers, every permission request denied, then `session/close` when the
 * agent advertises it), read into the answer or a typed failure. Stop reasons
 * are ACP's `StopReason` (@agentclientprotocol/sdk 1.1.0).
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

describe('readAcpOneShotResult', () => {
  it("is the agent's message text when the turn ended normally", () => {
    expect(
      readAcpOneShotResult({
        agent: 'opencode',
        stopReason: 'end_turn',
        agentText: 'Redirect to the dashboard after login',
        error: null,
        stderr: '',
      })
    ).toBe('Redirect to the dashboard after login');
  });

  it('a refusal is a failure saying the agent refused, with what it said', () => {
    const failure = failureOf(() =>
      readAcpOneShotResult({
        agent: 'goose',
        stopReason: 'refusal',
        agentText: 'I cannot help with that.',
        error: null,
        stderr: '',
      })
    );
    expect(failure).toMatchObject({ type: 'agent_failed', agent: 'goose' });
    expect(failure.type === 'agent_failed' && failure.message).toMatch(/refused/i);
    expect(failure.type === 'agent_failed' && failure.output?.text).toContain('cannot help');
  });

  it('running out of tokens or turns is a failure naming why', () => {
    for (const stopReason of ['max_tokens', 'max_turn_requests'] as const) {
      const failure = failureOf(() =>
        readAcpOneShotResult({
          agent: 'qwen',
          stopReason,
          agentText: 'Redir',
          error: null,
          stderr: '',
        })
      );
      expect(failure).toMatchObject({ type: 'agent_failed', agent: 'qwen' });
      expect(failure.type === 'agent_failed' && failure.message).toContain(stopReason);
    }
  });

  it('a protocol or process error is a failure carrying it and stderr', () => {
    const failure = failureOf(() =>
      readAcpOneShotResult({
        agent: 'opencode',
        stopReason: null,
        agentText: '',
        error: 'Authentication required',
        stderr: 'opencode: no provider configured',
      })
    );
    expect(failure).toMatchObject({ type: 'agent_failed', agent: 'opencode' });
    expect(failure.type === 'agent_failed' && failure.message).toContain('Authentication required');
    expect(failure.type === 'agent_failed' && failure.output?.text).toContain('no provider');
  });

  it('a cancelled turn is a cancel', () => {
    expect(
      failureOf(() =>
        readAcpOneShotResult({
          agent: 'opencode',
          stopReason: 'cancelled',
          agentText: 'Redir',
          error: null,
          stderr: '',
        })
      )
    ).toEqual({ type: 'canceled' });
  });

  it('a normal end with no text is a failure, not an empty message', () => {
    expect(
      failureOf(() =>
        readAcpOneShotResult({
          agent: 'opencode',
          stopReason: 'end_turn',
          agentText: ' \n',
          error: null,
          stderr: '',
        })
      )
    ).toMatchObject({ type: 'agent_failed', agent: 'opencode' });
  });
});

describe('acpCanCloseSession', () => {
  it('is true only when the agent advertises session/close', () => {
    expect(acpCanCloseSession({ sessionCapabilities: { close: {} } })).toBe(true);
    expect(acpCanCloseSession({ sessionCapabilities: { close: null } })).toBe(false);
    expect(acpCanCloseSession({ sessionCapabilities: {} })).toBe(false);
    expect(acpCanCloseSession({})).toBe(false);
  });
});
