import { describe, expect, it } from 'vitest';
import { inviteCandidates } from './invite-candidates';

const ROSTER = [
  {
    user_id: 'u-raghav',
    role: 'owner',
    email: 'raghav@example.com',
    name: 'Raghav',
    avatar_url: null,
  },
  { user_id: 'u-maya', role: 'member', email: 'maya@example.com', name: 'Maya', avatar_url: null },
  { user_id: 'u-kaden', role: 'member', email: 'kaden@example.com', name: null, avatar_url: null },
];

/**
 * Who the Share dialog offers to invite (shared-items step 3, decision 3):
 * the team, minus the owner and whoever already has access; an email outside
 * the team is offered too, for "Add to team and share".
 */
describe('inviteCandidates', () => {
  it('offers the team, minus the author and the people who already have access', () => {
    const candidates = inviteCandidates({
      roster: ROSTER,
      authorId: 'u-raghav',
      memberUserIds: ['u-maya'],
      query: '',
    });
    expect(candidates).toEqual([
      {
        kind: 'teammate',
        user_id: 'u-kaden',
        email: 'kaden@example.com',
        name: null,
        avatar_url: null,
      },
    ]);
  });

  it('narrows by name or email, ignoring case', () => {
    const candidates = inviteCandidates({
      roster: ROSTER,
      authorId: 'u-raghav',
      memberUserIds: [],
      query: 'MAY',
    });
    expect(candidates.map((c) => c.email)).toEqual(['maya@example.com']);
  });

  it('offers an email outside the team as one to add to the team', () => {
    expect(
      inviteCandidates({
        roster: ROSTER,
        authorId: 'u-raghav',
        memberUserIds: [],
        query: 'Priya@Elsewhere.dev',
      })
    ).toEqual([{ kind: 'outside', email: 'priya@elsewhere.dev' }]);
  });

  it('does not offer a teammate twice when their whole email is typed', () => {
    expect(
      inviteCandidates({
        roster: ROSTER,
        authorId: 'u-raghav',
        memberUserIds: [],
        query: 'maya@example.com',
      })
    ).toEqual([
      {
        kind: 'teammate',
        user_id: 'u-maya',
        email: 'maya@example.com',
        name: 'Maya',
        avatar_url: null,
      },
    ]);
  });
});
