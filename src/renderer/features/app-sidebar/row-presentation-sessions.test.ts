import { describe, expect, it } from 'vitest';
import { getSessionRowProviderId } from './row-presentation';

/**
 * devstation-ceg: the sidebar's session rows wore the agent's logo for a chat
 * and for the same agent run in a terminal, so a Claude chat and Claude Code
 * in a terminal looked identical there. The centre tab (`describeSessionTab`)
 * and the rail (`worktree-group.tsx`) give a terminal the terminal glyph; the
 * sidebar follows them.
 */
describe('getSessionRowProviderId', () => {
  it("is a chat's own agent, whose logo the row wears", () => {
    expect(getSessionRowProviderId({ kind: 'chat', providerId: 'claude' })).toBe('claude');
  });

  it('is nothing for an agent run in a terminal: the row wears the terminal glyph', () => {
    expect(getSessionRowProviderId({ kind: 'terminal', providerId: 'claude' })).toBeNull();
  });

  it('is nothing for a plain terminal', () => {
    expect(getSessionRowProviderId({ kind: 'terminal', providerId: null })).toBeNull();
  });

  it('is nothing for a chat whose provider is not registered', () => {
    expect(getSessionRowProviderId({ kind: 'chat', providerId: 'not-an-agent' })).toBeNull();
  });
});
