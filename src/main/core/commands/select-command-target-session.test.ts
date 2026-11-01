import { describe, expect, it } from 'vitest';
import { selectCommandTargetSession } from './select-command-target-session';

const chatA = { sessionId: 'a', kind: 'chat' };
const chatB = { sessionId: 'b', kind: 'chat' };
const terminal = { sessionId: 't', kind: 'terminal' };

describe('selectCommandTargetSession', () => {
  it('delivers into the thread the command names', () => {
    expect(selectCommandTargetSession([chatA, chatB], 'b')).toBe(chatB);
  });

  // The bug this exists to stop: two agents in one work item, and a teammate's
  // prompt silently reaching the one they did not address.
  it('never falls back to another thread when the named one is not live', () => {
    expect(selectCommandTargetSession([chatA, chatB], 'gone')).toBeUndefined();
  });

  it('falls back to the first chat session when no thread is named', () => {
    expect(selectCommandTargetSession([chatA, chatB], null)).toBe(chatA);
    expect(selectCommandTargetSession([chatA, chatB], undefined)).toBe(chatA);
  });

  it('never delivers a prompt into a terminal', () => {
    expect(selectCommandTargetSession([terminal], null)).toBeUndefined();
    expect(selectCommandTargetSession([terminal], 't')).toBeUndefined();
  });

  it('has nothing to deliver into when the work item runs no session', () => {
    expect(selectCommandTargetSession([], null)).toBeUndefined();
    expect(selectCommandTargetSession([], 'a')).toBeUndefined();
  });
});
