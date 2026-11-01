import type { CloudChatMessage } from '@chord/protocol';
import { describe, expect, it } from 'vitest';
import { lastServerConfirmed, reachesBack } from './cloud-chat-store';

function row(id: string, createdAt: string): CloudChatMessage {
  return {
    id,
    work_item_id: 'item_1',
    session_id: null,
    sender_id: 'user_a',
    sender_type: 'human',
    sender_name: 'a@example.com',
    content: id,
    message_type: 'text',
    metadata: {},
    created_at: createdAt,
  };
}

describe('lastServerConfirmed', () => {
  it('returns the newest row when nothing is un-acked', () => {
    const order = [row('m1', '2026-01-01T00:00:00.000Z'), row('m2', '2026-01-01T00:00:01.000Z')];
    expect(lastServerConfirmed(order, new Set())?.id).toBe('m2');
  });

  it('skips a trailing optimistic row whose timestamp is this machine’s clock', () => {
    // The un-acked row carries a local timestamp far in the server's future —
    // using it as the `?after=` cursor would skip every message the outage
    // dropped. The last server-stamped row is the only sound cursor.
    const order = [row('m1', '2026-01-01T00:00:00.000Z'), row('local', '2026-06-01T00:00:00.000Z')];
    expect(lastServerConfirmed(order, new Set(['local']))?.id).toBe('m1');
  });

  it('skips a run of consecutive un-acked rows', () => {
    const order = [
      row('m1', '2026-01-01T00:00:00.000Z'),
      row('local1', '2026-06-01T00:00:00.000Z'),
      row('local2', '2026-06-01T00:00:01.000Z'),
    ];
    expect(lastServerConfirmed(order, new Set(['local1', 'local2']))?.id).toBe('m1');
  });

  it('returns undefined when every row is un-acked, so the caller reseeds a full page', () => {
    const order = [row('local1', '2026-06-01T00:00:00.000Z')];
    expect(lastServerConfirmed(order, new Set(['local1']))).toBeUndefined();
  });

  it('returns undefined for an empty feed', () => {
    expect(lastServerConfirmed([], new Set())).toBeUndefined();
  });
});

/**
 * Step 5: a reveal pages the feed back until it holds the target, so the loop
 * asks whether the oldest loaded row is at or before it.
 */
describe('reachesBack', () => {
  const order = [row('m2', '2026-01-01T00:00:02.000Z'), row('m3', '2026-01-01T00:00:03.000Z')];

  it('is true once the oldest loaded row is at or before the target', () => {
    expect(reachesBack(order, { id: 'm2', created_at: '2026-01-01T00:00:02.000Z' })).toBe(true);
    expect(reachesBack(order, { id: 'm3', created_at: '2026-01-01T00:00:03.000Z' })).toBe(true);
  });

  it('is false while the target is older than everything loaded', () => {
    expect(reachesBack(order, { id: 'm1', created_at: '2026-01-01T00:00:01.000Z' })).toBe(false);
  });

  it('breaks a same-millisecond tie by id, as the server orders', () => {
    const tied = [row('b', '2026-01-01T00:00:02.000Z')];
    expect(reachesBack(tied, { id: 'a', created_at: '2026-01-01T00:00:02.000Z' })).toBe(false);
    expect(reachesBack(tied, { id: 'c', created_at: '2026-01-01T00:00:02.000Z' })).toBe(true);
  });

  it('is false for an empty feed', () => {
    expect(reachesBack([], { id: 'm1', created_at: '2026-01-01T00:00:01.000Z' })).toBe(false);
  });
});
