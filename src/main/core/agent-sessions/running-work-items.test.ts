import { describe, expect, it } from 'vitest';
import type { ActiveSession } from '@main/core/work-items/active-sessions';
import { selectRunningWorkItemIds } from './running-work-items';

function session(overrides: Partial<ActiveSession> & Pick<ActiveSession, 'sessionId'>) {
  return {
    workItemId: 'wi-1',
    providerId: 'claude',
    mode: 'claude-sdk',
    kind: 'chat',
    ...overrides,
  } as ActiveSession;
}

describe('selectRunningWorkItemIds', () => {
  it('returns nothing when no session is live', () => {
    expect(selectRunningWorkItemIds([])).toEqual([]);
  });

  it('reports the work item of a live chat session', () => {
    const ids = selectRunningWorkItemIds([session({ sessionId: 's1', workItemId: 'wi-a' })]);
    expect(ids).toEqual(['wi-a']);
  });

  it('ignores terminal sessions so an open shell does not badge a row running', () => {
    const ids = selectRunningWorkItemIds([
      session({ sessionId: 's1', workItemId: 'wi-a', kind: 'terminal', mode: 'pty' }),
    ]);
    expect(ids).toEqual([]);
  });

  it('counts a work item once when it owns several live chat sessions', () => {
    const ids = selectRunningWorkItemIds([
      session({ sessionId: 's1', workItemId: 'wi-a' }),
      session({ sessionId: 's2', workItemId: 'wi-a' }),
    ]);
    expect(ids).toEqual(['wi-a']);
  });

  it('keeps every distinct work item that has a live chat session', () => {
    const ids = selectRunningWorkItemIds([
      session({ sessionId: 's1', workItemId: 'wi-a' }),
      session({ sessionId: 's2', workItemId: 'wi-b', kind: 'terminal', mode: 'pty' }),
      session({ sessionId: 's3', workItemId: 'wi-c', mode: 'pty' }),
    ]);
    expect(ids).toEqual(['wi-a', 'wi-c']);
  });
});
