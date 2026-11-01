import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Every session start and end funnels through the active-session registry
 * (`session-service` is its only writer), so it is where the renderer is told
 * a work item's sessions changed — `agent:sessions-changed`, topic = work
 * item — and the sidebar reads them at once instead of at its next poll
 * (devstation-6jg). Only the window transport is replaced, to see what is
 * sent; the database is the real SQLite built from the shipped migrations.
 */
const sent: { name: string; data: unknown; topic?: string }[] = [];

vi.mock('@main/lib/events', () => ({
  events: {
    emit: (channel: { name: string }, data: unknown, topic?: string) =>
      sent.push({ name: channel.name, data, topic }),
  },
}));
vi.mock('@main/db/client', async () => ({
  db: (await import('@main/core/work-items/test-support/work-items-test-db')).testDrizzle,
}));

const { registerActiveSession, unregisterActiveSession } = await import('./active-sessions');

const changed = (workItemId: string) => ({
  name: 'agent:sessions-changed',
  data: { workItemId },
  topic: workItemId,
});

describe('active sessions tell the renderer what changed', () => {
  beforeEach(() => {
    // The cloud push the registry also schedules stays pending: not under test.
    vi.useFakeTimers();
    sent.length = 0;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('announces a session that started', () => {
    registerActiveSession({
      sessionId: 'session-start',
      workItemId: 'wi-1',
      providerId: 'claude',
      mode: 'pty',
      kind: 'terminal',
    });

    expect(sent).toContainEqual(changed('wi-1'));
    unregisterActiveSession('session-start');
  });

  it('announces a session that ended', () => {
    registerActiveSession({
      sessionId: 'session-end',
      workItemId: 'wi-2',
      providerId: null,
      mode: 'shell',
      kind: 'terminal',
    });
    sent.length = 0;

    unregisterActiveSession('session-end');

    expect(sent).toEqual([changed('wi-2')]);
  });

  it('says nothing for a session that was not running', () => {
    unregisterActiveSession('never-started');

    expect(sent).toEqual([]);
  });
});
