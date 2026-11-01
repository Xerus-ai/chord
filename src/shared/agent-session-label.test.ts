import { describe, expect, it } from 'vitest';
import { labelAgentSession } from './agent-session-label';

/**
 * One name per session on every surface — the centre tab, the right rail's
 * worktree row and the sidebar row (devstation-jop). An agent's CLI in a
 * terminal is named after the agent; only a shell is "a terminal".
 */
describe('labelAgentSession', () => {
  it('names an agent terminal after its agent', () => {
    expect(labelAgentSession({ kind: 'terminal', title: null, agentProviderId: 'claude' })).toBe(
      'Claude Code'
    );
    expect(labelAgentSession({ kind: 'terminal', title: null, agentProviderId: 'codex' })).toBe(
      'Codex'
    );
  });

  it('names a shell terminal by its title, the shell’s label', () => {
    expect(
      labelAgentSession({ kind: 'terminal', title: 'PowerShell', agentProviderId: null })
    ).toBe('PowerShell');
  });

  it('calls an untitled terminal with no agent a terminal', () => {
    expect(labelAgentSession({ kind: 'terminal', title: null, agentProviderId: null })).toBe(
      'Terminal'
    );
  });

  it('names an untitled chat after its agent, and a titled one by its title', () => {
    expect(labelAgentSession({ kind: 'chat', title: null, agentProviderId: 'claude' })).toBe(
      'Claude Code'
    );
    expect(labelAgentSession({ kind: 'chat', title: 'Fix tests', agentProviderId: 'claude' })).toBe(
      'Fix tests'
    );
  });

  it('calls a chat with an unknown agent a chat', () => {
    expect(labelAgentSession({ kind: 'chat', title: null, agentProviderId: 'not-an-agent' })).toBe(
      'Chat'
    );
  });
});
