import { describe, expect, it } from 'vitest';
import type { AgentSessionRow } from '@main/db/schema-work-items';
import { orderSessionRows, sessionRowStatus } from './session-row-presentation';

function session(overrides: Partial<AgentSessionRow> & { id: string }): AgentSessionRow {
  return {
    workItemId: 'w-1',
    kind: 'chat',
    agentProviderId: 'claude',
    shell: null,
    communication: 'acp',
    externalSessionId: null,
    title: null,
    cwd: null,
    status: 'active',
    respawnCount: 0,
    provisionStatus: 'ready',
    ownedByAnotherAccount: false,
    lastTurnStatus: null,
    lastTurnStatusAt: null,
    model: null,
    worktreeId: null,
    createdAt: 1000,
    lastActiveAt: 1000,
    ...overrides,
  } as AgentSessionRow;
}

describe('sessionRowStatus', () => {
  it('an active session is live and pulses', () => {
    expect(sessionRowStatus(session({ id: 's-1', status: 'active' }))).toEqual({
      live: true,
      word: 'live',
      signal: 'running',
      showAge: false,
    });
  });

  // devstation-6z4o: a suspended chat has no process, and the next send resumes
  // its conversation (a Reset chat included). "suspended" read as broken.
  it('a suspended chat reads ready, with its age', () => {
    expect(sessionRowStatus(session({ id: 's-1', status: 'suspended' }))).toEqual({
      live: false,
      word: 'ready',
      signal: 'neutral',
      showAge: true,
    });
  });

  it('a suspended terminal keeps its lifecycle word: it resumes when opened, not on a send', () => {
    expect(sessionRowStatus(session({ id: 's-1', kind: 'terminal', status: 'suspended' }))).toEqual(
      {
        live: false,
        word: 'suspended',
        signal: 'neutral',
        showAge: true,
      }
    );
  });

  // devstation-vzg: the rail said "done" (the raw `status`) where the `+` menus
  // say "Ended" for the same session. One word for one state, in both places.
  it('a done session reads ended, as the + menus call it, with its age', () => {
    expect(sessionRowStatus(session({ id: 's-1', status: 'done' }))).toEqual({
      live: false,
      word: 'ended',
      signal: 'neutral',
      showAge: true,
    });
  });

  // The signal the map was missing: `last_turn_status` is deliberately separate
  // from `status` (schema-work-items.ts:131-134), and the sidebar already reads
  // it as `lastTurnErrored`. A session can sit at status 'suspended' with a
  // failed last turn, and that is exactly the row a user is looking for.
  it('a failed last turn outranks the lifecycle word, on a suspended session', () => {
    expect(
      sessionRowStatus(session({ id: 's-1', status: 'suspended', lastTurnStatus: 'error' }))
    ).toEqual({ live: false, word: 'failed', signal: 'danger', showAge: true });
  });

  // Same precedence as deriveWorktreeStatus: failed beats working. A live
  // session whose last turn errored must not pulse as though it were fine.
  it('a failed last turn outranks live, and stops the pulse', () => {
    expect(
      sessionRowStatus(session({ id: 's-1', status: 'active', lastTurnStatus: 'error' }))
    ).toEqual({ live: false, word: 'failed', signal: 'danger', showAge: true });
  });

  it('a non-error last turn status does not colour the row', () => {
    expect(sessionRowStatus(session({ id: 's-1', lastTurnStatus: 'ok' })).word).toBe('live');
  });
});

describe('orderSessionRows', () => {
  // Stage 6a: finished sessions are no longer hidden behind a disclosure, so
  // one recency order has to carry active, suspended and done together.
  it('orders by last activity, newest first, regardless of status', () => {
    const rows = orderSessionRows([
      session({ id: 'old-active', status: 'active', lastActiveAt: 100 }),
      session({ id: 'recent-done', status: 'done', lastActiveAt: 900 }),
      session({ id: 'mid-suspended', status: 'suspended', lastActiveAt: 500 }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(['recent-done', 'mid-suspended', 'old-active']);
  });

  it('breaks ties on creation time so the order never flickers between polls', () => {
    const rows = orderSessionRows([
      session({ id: 'older', lastActiveAt: 500, createdAt: 10 }),
      session({ id: 'newer', lastActiveAt: 500, createdAt: 20 }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(['newer', 'older']);
  });

  it('does not mutate the array it was given', () => {
    const input = [
      session({ id: 'a', lastActiveAt: 100 }),
      session({ id: 'b', lastActiveAt: 900 }),
    ];
    orderSessionRows(input);
    expect(input.map((row) => row.id)).toEqual(['a', 'b']);
  });
});
