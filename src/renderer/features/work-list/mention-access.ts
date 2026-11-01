import type { MemberRole } from '@renderer/features/sharing/sharing-api';
import type { RoutableParticipant } from './chat-routing';

interface Person extends RoutableParticipant {
  avatar_url: string | null;
}

/** Someone the owner can mention, and whether they can see the work item. */
export interface MentionPerson extends Person {
  hasAccess: boolean;
}

/**
 * Who the owner can @mention (shared-items design §5): the people with
 * access, then everyone else in the team, marked as not able to see it yet.
 * With team access, everyone in the team can.
 */
export function mentionRoster({
  participants,
  team,
  generalAccess,
}: {
  participants: Person[];
  team: Person[];
  generalAccess: string;
}): MentionPerson[] {
  const withAccess = new Set(participants.map((person) => person.user_id));
  const teamCanOpen = generalAccess === 'team';
  return [
    ...participants.map((person) => ({ ...person, hasAccess: true })),
    ...team
      .filter((person) => !withAccess.has(person.user_id))
      .map((person) => ({
        user_id: person.user_id,
        email: person.email,
        name: person.name,
        avatar_url: person.avatar_url,
        hasAccess: teamCanOpen,
      })),
  ];
}

/**
 * Who a teammate can @mention (step 4, decision 8): the people who can see the
 * work item, and never anyone who cannot, since only the owner shares. With
 * team access the whole team can see it; `team` is null when the teammate is
 * not in the item's team and so cannot read it.
 */
export function memberMentionRoster({
  participants,
  team,
  generalAccess,
}: {
  participants: Person[];
  team: Person[] | null;
  generalAccess: string;
}): MentionPerson[] {
  const withAccess = participants.map((person) => ({ ...person, hasAccess: true }));
  if (generalAccess !== 'team' || team === null) return withAccess;
  return mentionRoster({ participants, team, generalAccess });
}

/** The mentioned people who cannot see the work item: the send asks about them first. */
export function mentionAccess(
  mentionedUserIds: string[],
  roster: MentionPerson[]
): MentionPerson[] {
  const mentioned = new Set(mentionedUserIds);
  return roster.filter((person) => mentioned.has(person.user_id) && !person.hasAccess);
}

/** The shares an answer to "{Priya} can't see this work item" makes before the send. */
export function planMentionShare(
  choice: MemberRole | 'dont',
  people: MentionPerson[]
): Array<{ email: string; role: MemberRole }> {
  if (choice === 'dont') return [];
  return people.map((person) => ({ email: person.email, role: choice }));
}
