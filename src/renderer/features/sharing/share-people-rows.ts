import type { MemberRole, SharingMember, SharingState } from './sharing-api';

interface PersonFields {
  key: string;
  name: string | null;
  email: string;
  avatarUrl: string | null;
}

export type SharePeopleRow =
  | (PersonFields & { kind: 'author' })
  | (PersonFields & { kind: 'member'; member: SharingMember })
  | (PersonFields & {
      kind: 'via_work_item';
      role: MemberRole;
      pending: boolean;
      tag: 'via work item';
    })
  | (PersonFields & {
      kind: 'artifacts_only';
      pending: boolean;
      /** "1 artifact", "2 artifacts". */
      tag: string;
      /** Where a click on the tag takes the dialog: that artifact's scope. */
      firstArtifactId: string;
    });

const personKey = (member: { user_id: string | null; email: string }) =>
  member.user_id ?? `pending:${member.email.toLowerCase()}`;

/**
 * "People with access" in the Share dialog (shared-items design §5): the
 * author, the members of what is being shared, and the people who reach it
 * another way: in an artifact's scope, through the work item (read-only
 * here); in the work item's, through some of its artifacts only.
 */
export function sharePeopleRows(state: SharingState): SharePeopleRow[] {
  const rows: SharePeopleRow[] = [
    {
      kind: 'author',
      key: state.author.user_id,
      name: state.author.name,
      email: state.author.email,
      avatarUrl: state.author.avatar_url,
    },
    ...state.members.map(
      (member): SharePeopleRow => ({
        kind: 'member',
        key: personKey(member),
        name: member.name,
        email: member.email,
        avatarUrl: member.avatar_url,
        member,
      })
    ),
  ];

  const listed = new Set(rows.map((row) => row.key));
  for (const member of state.work_item?.members ?? []) {
    const key = personKey(member);
    if (listed.has(key)) continue;
    rows.push({
      kind: 'via_work_item',
      key,
      name: member.name,
      email: member.email,
      avatarUrl: member.avatar_url,
      role: member.role,
      pending: member.pending,
      tag: 'via work item',
    });
  }

  for (const person of state.artifact_members) {
    const count = person.artifacts.length;
    rows.push({
      kind: 'artifacts_only',
      key: personKey(person),
      name: person.name,
      email: person.email,
      avatarUrl: person.avatar_url,
      pending: person.pending,
      tag: `${count} ${count === 1 ? 'artifact' : 'artifacts'}`,
      firstArtifactId: person.artifacts[0]!.artifact_id,
    });
  }
  return rows;
}
