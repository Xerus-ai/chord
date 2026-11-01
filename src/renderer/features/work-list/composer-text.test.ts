import { describe, expect, it } from 'vitest';
import { composerHint, composerPlaceholder } from './composer-text';

/**
 * A blocked composer looks like any other (user decision 2026-10-01): the
 * reason it is blocked is its placeholder, inside the box, not a blank box
 * with the reason under it.
 */
describe('composerPlaceholder', () => {
  it("is the reason a blocked composer can't send", () => {
    expect(
      composerPlaceholder({
        blockedReason: 'Read-only access — ask the owner for edit access to post messages.',
        agentBlockedReason: null,
        agentControls: false,
      })
    ).toBe('Read-only access — ask the owner for edit access to post messages.');
  });

  it("is the owner's prompt with the agent controls", () => {
    expect(
      composerPlaceholder({ blockedReason: null, agentBlockedReason: null, agentControls: true })
    ).toBe('Message the agent, mention @people, +files, or use / for commands');
  });

  it("is the thread for a teammate, with or without the agent's ear", () => {
    expect(
      composerPlaceholder({
        blockedReason: null,
        agentBlockedReason: 'Only the owner can prompt the agent.',
        agentControls: false,
      })
    ).toBe('Message the thread, or mention @people…');
    expect(
      composerPlaceholder({ blockedReason: null, agentBlockedReason: null, agentControls: false })
    ).toBe('Message the thread, or @agent to prompt it…');
  });
});

describe('composerHint', () => {
  it('shows an error first, then a notice, and never repeats the blocked reason', () => {
    expect(composerHint({ error: 'Send failed', notice: 'Owner offline' })).toBe('Send failed');
    expect(composerHint({ error: null, notice: 'Owner offline' })).toBe('Owner offline');
    expect(composerHint({ error: null, notice: null })).toBeNull();
  });
});
