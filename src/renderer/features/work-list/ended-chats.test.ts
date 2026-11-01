import { describe, expect, it } from 'vitest';
import { listEndedChats } from './ended-chats';

const s = (id: string, kind: string, status: string, lastActiveAt: number) => ({
  id,
  kind,
  status,
  lastActiveAt,
});

/**
 * The owner's `+` lists ended chats under "Ended" (shared-items step 5,
 * decision 5): before this, a chat whose tab closed was out of the owner's
 * reach for good, while a teammate could reopen it.
 */
describe('listEndedChats', () => {
  it('lists ended chats, the most recently active first', () => {
    const sessions = [
      s('a', 'chat', 'done', 100),
      s('b', 'chat', 'active', 900),
      s('c', 'chat', 'done', 300),
      s('d', 'chat', 'suspended', 50),
    ];
    expect(listEndedChats(sessions).map((x) => x.id)).toEqual(['c', 'a']);
  });

  it('leaves out ended terminals: they have no transcript', () => {
    expect(listEndedChats([s('t', 'terminal', 'done', 100)])).toEqual([]);
  });
});
