import type { OrgMember } from '@renderer/lib/cloud-team-api';

export type InviteCandidate =
  | {
      kind: 'teammate';
      user_id: string;
      email: string;
      name: string | null;
      avatar_url: string | null;
    }
  | { kind: 'outside'; email: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Who the Share dialog offers to invite (shared-items step 3, decision 3):
 * the team, minus the owner and whoever already has access, narrowed by what
 * was typed; a whole email outside the team is offered too, for "Add to team
 * and share".
 */
export function inviteCandidates({
  roster,
  authorId,
  memberUserIds,
  query,
}: {
  roster: OrgMember[];
  authorId: string;
  memberUserIds: string[];
  query: string;
}): InviteCandidate[] {
  const needle = query.trim().toLowerCase();
  const taken = new Set([authorId, ...memberUserIds]);
  const teammates: InviteCandidate[] = roster
    .filter((person) => !taken.has(person.user_id))
    .filter(
      (person) =>
        needle === '' ||
        person.email.toLowerCase().includes(needle) ||
        (person.name?.toLowerCase().includes(needle) ?? false)
    )
    .map((person) => ({
      kind: 'teammate',
      user_id: person.user_id,
      email: person.email,
      name: person.name,
      avatar_url: person.avatar_url,
    }));
  const inTeam = roster.some((person) => person.email.toLowerCase() === needle);
  if (EMAIL.test(needle) && !inTeam) return [...teammates, { kind: 'outside', email: needle }];
  return teammates;
}
