import { cloudFetch } from '@renderer/lib/cloud-fetch';

/**
 * P6 sharing over the cloud API — one model for work items and artifacts
 * (server/src/routes/sharing). A ref names the resource: a work item, or one
 * artifact in it.
 */

export type AccessRole = 'view' | 'edit' | 'author';
export type MemberRole = Exclude<AccessRole, 'author'>;
export type GeneralAccess = 'invited' | 'team' | 'link';

export const ACCESS_ROLE_LABELS: Record<AccessRole, string> = {
  author: 'Author',
  edit: 'Can edit',
  view: 'Can view',
};

export interface SharingRef {
  workItemId: string;
  /** Absent = the work item itself. */
  artifactId?: string;
}

export interface SharingPerson {
  user_id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
}

export interface SharingMember {
  id: string;
  /** null while the invite is pending (outside the team until they join). */
  user_id: string | null;
  email: string;
  name: string | null;
  avatar_url: string | null;
  role: MemberRole;
  pending: boolean;
}

/** Someone only some of a work item's artifacts were shared with (author only). */
export interface ArtifactOnlyMember {
  user_id: string | null;
  email: string;
  name: string | null;
  avatar_url: string | null;
  pending: boolean;
  artifacts: Array<{
    member_id: string;
    artifact_id: string;
    artifact_name: string;
    role: MemberRole;
  }>;
}

export interface ShareLink {
  url: string;
  comments_enabled: boolean;
}

export interface SharingState {
  caller_role: AccessRole;
  author: SharingPerson;
  /** The work item's team: whose roster invites come from, and "Everyone in {team}". */
  team: { id: string; name: string };
  general_access: GeneralAccess;
  general_role: MemberRole;
  members: SharingMember[];
  /** Work item scope, author only: who holds only some of its artifacts. */
  artifact_members: ArtifactOnlyMember[];
  team_allows_public_links: boolean;
  /** The live public link — author only, artifacts only. */
  link: ShareLink | null;
  /** For an artifact, the access it inherits from its work item (hidden from artifact-only members). */
  work_item: {
    id: string;
    name: string;
    general_access: GeneralAccess;
    general_role: MemberRole;
    members: SharingMember[];
  } | null;
}

/** Someone on a work item: the author plus its active members. */
export interface Participant extends SharingPerson {
  role: AccessRole;
}

/** One row of You › Sharing: something the caller shared (GET /sharing/shared-by-me). */
export interface SharedByMeRow {
  kind: 'work_item' | 'artifact';
  work_item_id: string;
  artifact_id: string | null;
  name: string;
  general_access: GeneralAccess;
  general_role: MemberRole;
  member_count: number;
  link_url: string | null;
  updated_at: string;
}

export interface SharingPolicy {
  allow_public_links: boolean;
  allow_confluence_publishing: boolean;
}

function basePath(ref: SharingRef): string {
  return ref.artifactId
    ? `/work-items/${ref.workItemId}/artifacts/${ref.artifactId}`
    : `/work-items/${ref.workItemId}`;
}

export const sharingApi = {
  getSharing: (ref: SharingRef) => cloudFetch<SharingState>(`${basePath(ref)}/sharing`),

  /**
   * `addToTeam`: the email is outside the team — invite them to it first (one
   * seat; team owner only). Without it such an email is refused with
   * NOT_A_TEAM_MEMBER so the UI can ask.
   */
  addMember: (ref: SharingRef, email: string, role: MemberRole, addToTeam: boolean) =>
    cloudFetch<SharingMember>(`${basePath(ref)}/members`, {
      method: 'POST',
      body: JSON.stringify({ email, role, add_to_team: addToTeam }),
    }),

  updateMemberRole: (ref: SharingRef, memberId: string, role: MemberRole) =>
    cloudFetch<SharingMember>(`${basePath(ref)}/members/${memberId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),

  removeMember: (ref: SharingRef, memberId: string) =>
    cloudFetch<void>(`${basePath(ref)}/members/${memberId}`, { method: 'DELETE' }),

  setGeneralAccess: (ref: SharingRef, generalAccess: GeneralAccess, generalRole: MemberRole) =>
    cloudFetch<{ general_access: GeneralAccess; general_role: MemberRole; link: ShareLink | null }>(
      `${basePath(ref)}/general-access`,
      {
        method: 'PATCH',
        body: JSON.stringify({ general_access: generalAccess, general_role: generalRole }),
      }
    ),

  setLinkComments: (ref: SharingRef, commentsEnabled: boolean) =>
    cloudFetch<ShareLink>(`${basePath(ref)}/link`, {
      method: 'PATCH',
      body: JSON.stringify({ comments_enabled: commentsEnabled }),
    }),

  /** Stop sharing: remove every member, back to only people invited, revoke a public link. */
  stopSharing: (ref: SharingRef) =>
    cloudFetch<void>(`${basePath(ref)}/sharing`, { method: 'DELETE' }),

  getSharedByMe: () => cloudFetch<SharedByMeRow[]>('/sharing/shared-by-me'),

  getSharingPolicy: (orgId: string) =>
    cloudFetch<SharingPolicy>(`/organizations/${orgId}/sharing-policy`),

  updateSharingPolicy: (orgId: string, patch: Partial<SharingPolicy>) =>
    cloudFetch<SharingPolicy>(`/organizations/${orgId}/sharing-policy`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  /** The author and the work item's active members — who a mention can reach. */
  getParticipants: async (workItemId: string): Promise<Participant[]> => {
    const sharing = await sharingApi.getSharing({ workItemId });
    const members = sharing.members.flatMap((member) =>
      member.user_id
        ? [
            {
              user_id: member.user_id,
              email: member.email,
              name: member.name,
              avatar_url: member.avatar_url,
              role: member.role,
            },
          ]
        : []
    );
    return [{ ...sharing.author, role: 'author' }, ...members];
  },
};
