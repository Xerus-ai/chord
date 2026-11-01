import { describe, expect, it } from 'vitest';
import { describeGenerateButton } from './generate-button-state';

/**
 * The Generate button in the commit field and in Create PR: it names the
 * chosen agent when that agent can't answer, shows progress while it runs,
 * and is the way to cancel.
 */
describe('describeGenerateButton', () => {
  it('offers Generate when the agent is ready, naming it in the tooltip', () => {
    expect(
      describeGenerateButton({
        agent: 'claude',
        status: { state: 'ready' },
        statusError: null,
        generating: false,
      })
    ).toEqual({
      label: 'Generate',
      disabled: false,
      busy: false,
      title: 'Write it with Claude Code',
    });
  });

  it('while generating, shows progress and becomes Cancel', () => {
    const state = describeGenerateButton({
      agent: 'codex',
      status: { state: 'ready' },
      statusError: null,
      generating: true,
    });
    expect(state).toMatchObject({ label: 'Cancel', disabled: false, busy: true });
    expect(state.title).toMatch(/Codex/);
    expect(state.title).toMatch(/cancel/i);
  });

  it('names an agent that is not installed on the button, disabled with the reason', () => {
    expect(
      describeGenerateButton({
        agent: 'codex',
        status: { state: 'not_installed', message: 'Codex is not installed on this machine.' },
        statusError: null,
        generating: false,
      })
    ).toEqual({
      label: 'Codex not installed',
      disabled: true,
      busy: false,
      title: 'Codex is not installed on this machine.',
    });
  });

  it('names an agent that is not signed in on the button, disabled with the reason', () => {
    expect(
      describeGenerateButton({
        agent: 'claude',
        status: { state: 'not_signed_in', message: 'Claude Code is not signed in.' },
        statusError: null,
        generating: false,
      })
    ).toEqual({
      label: 'Claude Code not signed in',
      disabled: true,
      busy: false,
      title: 'Claude Code is not signed in.',
    });
  });

  it('names an ACP agent that could not start a session, disabled with the reason', () => {
    expect(
      describeGenerateButton({
        agent: 'opencode',
        status: {
          state: 'unavailable',
          message: 'OpenCode could not start a session: Authentication required',
        },
        statusError: null,
        generating: false,
      })
    ).toEqual({
      label: 'OpenCode unavailable',
      disabled: true,
      busy: false,
      title: 'OpenCode could not start a session: Authentication required',
    });
  });

  it('waits, disabled, while the agent is being checked', () => {
    expect(
      describeGenerateButton({
        agent: 'claude',
        status: null,
        statusError: null,
        generating: false,
      })
    ).toEqual({
      label: 'Generate',
      disabled: true,
      busy: false,
      title: 'Checking Claude Code…',
    });
  });

  it('says the check itself failed, disabled, rather than guessing', () => {
    const state = describeGenerateButton({
      agent: 'codex',
      status: null,
      statusError: 'codex app-server exited (code 1)',
      generating: false,
    });
    expect(state.disabled).toBe(true);
    expect(state.title).toContain('codex app-server exited (code 1)');
  });
});
