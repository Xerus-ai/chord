import { describe, expect, it } from 'vitest';
import {
  memberMentionRoster,
  mentionAccess,
  mentionRoster,
  planMentionShare,
} from './mention-access';

const RAGHAV = {
  user_id: 'u-raghav',
  email: 'raghav@example.com',
  name: 'Raghav',
  avatar_url: null,
};
const MAYA = { user_id: 'u-maya', email: 'maya@example.com', name: 'Maya', avatar_url: null };
const PRIYA = { user_id: 'u-priya', email: 'priya@example.com', name: 'Priya', avatar_url: null };
const TEAM = [
  { ...RAGHAV, role: 'owner' },
  { ...MAYA, role: 'member' },
  { ...PRIYA, role: 'member' },
];

/**
 * Sharing by @mention (shared-items design §5): the owner can mention anyone
 * in the team; mentioning someone who cannot see the work item asks whether
 * to share it with them before the message goes out.
 */
describe('mentionRoster', () => {
  it('offers the people with access, then the rest of the team, marked', () => {
    const roster = mentionRoster({
      participants: [RAGHAV, MAYA],
      team: TEAM,
      generalAccess: 'invited',
    });
    expect(roster.map((p) => [p.user_id, p.hasAccess])).toEqual([
      ['u-raghav', true],
      ['u-maya', true],
      ['u-priya', false],
    ]);
  });

  it('marks everyone in the team as having access when the team can open it', () => {
    const roster = mentionRoster({ participants: [RAGHAV], team: TEAM, generalAccess: 'team' });
    expect(roster.every((p) => p.hasAccess)).toBe(true);
    expect(roster).toHaveLength(3);
  });
});

describe('mentionAccess', () => {
  it('names the mentioned people who cannot see the work item', () => {
    const roster = mentionRoster({
      participants: [RAGHAV, MAYA],
      team: TEAM,
      generalAccess: 'invited',
    });
    expect(mentionAccess(['u-maya', 'u-priya'], roster).map((p) => p.user_id)).toEqual(['u-priya']);
  });

  it('asks about nobody when everyone mentioned has access', () => {
    const roster = mentionRoster({
      participants: [RAGHAV, MAYA],
      team: TEAM,
      generalAccess: 'invited',
    });
    expect(mentionAccess(['u-maya'], roster)).toEqual([]);
  });
});

describe('planMentionShare', () => {
  const people = [{ ...PRIYA, hasAccess: false }];

  it('shares with them at the chosen role before the message is sent', () => {
    expect(planMentionShare('edit', people)).toEqual([
      { email: 'priya@example.com', role: 'edit' },
    ]);
  });

  it("shares with nobody on Don't share", () => {
    expect(planMentionShare('dont', people)).toEqual([]);
  });
});

/**
 * A teammate's @ roster (step 4, decision 8): the people who can see the work
 * item, never anyone who cannot (a teammate has no share bar). With team
 * access that is the whole team, read only when the teammate is in it.
 */
describe('memberMentionRoster', () => {
  it('offers the people with access when the item is shared by invitation', () => {
    const roster = memberMentionRoster({
      participants: [RAGHAV, MAYA],
      team: TEAM,
      generalAccess: 'invited',
    });
    expect(roster.map((p) => [p.user_id, p.hasAccess])).toEqual([
      ['u-raghav', true],
      ['u-maya', true],
    ]);
  });

  it('adds the team when the team can open the item', () => {
    const roster = memberMentionRoster({
      participants: [RAGHAV, MAYA],
      team: TEAM,
      generalAccess: 'team',
    });
    expect(roster.map((p) => [p.user_id, p.hasAccess])).toEqual([
      ['u-raghav', true],
      ['u-maya', true],
      ['u-priya', true],
    ]);
  });

  it('offers the people with access alone when the teammate is not in the team', () => {
    const roster = memberMentionRoster({
      participants: [RAGHAV],
      team: null,
      generalAccess: 'team',
    });
    expect(roster.map((p) => p.user_id)).toEqual(['u-raghav']);
  });
});
