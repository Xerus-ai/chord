import { describe, expect, it } from 'vitest';
import { stackMembers } from './header-stack';

const person = (user_id: string, name: string) => ({
  user_id,
  name,
  email: `${name.toLowerCase()}@example.com`,
  avatar_url: null,
  role: 'edit' as const,
});

const RAGHAV = person('u-raghav', 'Raghav');
const MAYA = person('u-maya', 'Maya');
const KADEN = person('u-kaden', 'Kaden');

/**
 * The header's avatar stack (shared-items design §5): the one visible sign
 * that an item is shared. It shows the people you share it with, the ones
 * looking at it right now first and ringed; never yourself.
 */
describe('stackMembers', () => {
  it('shows nobody for an item that is not shared', () => {
    expect(stackMembers([RAGHAV], [], 'u-raghav')).toEqual({ members: [], ringedIds: new Set() });
  });

  it('leaves you out, and puts the people viewing it now first, ringed', () => {
    const { members, ringedIds } = stackMembers(
      [RAGHAV, MAYA, KADEN],
      [{ user_id: 'u-kaden', file: 'hero.html' }],
      'u-raghav'
    );
    expect(members.map((m) => m.user_id)).toEqual(['u-kaden', 'u-maya']);
    expect(ringedIds).toEqual(new Set(['u-kaden']));
  });

  it('does not ring you when the presence feed lists you', () => {
    const { ringedIds } = stackMembers(
      [RAGHAV, MAYA],
      [{ user_id: 'u-raghav', file: 'chat' }],
      'u-raghav'
    );
    expect(ringedIds).toEqual(new Set());
  });
});
