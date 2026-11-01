import { and, desc, eq, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '../db/client.js';
import { artifacts } from '../db/schema-artifacts.js';
import { resourceMembers } from '../db/schema-sharing.js';
import { orgMemberships, workItems } from '../db/schema.js';
import { readCachedAccess, writeCachedAccess } from './access-cache.js';

/**
 * The one access resolver for work items and artifacts (P6). REST middleware
 * (access-middleware.ts), WS rooms (ws/authorize.ts) and Hocuspocus
 * (hocuspocus.ts) all ask it; nothing else decides who may see what.
 *
 *   work item: author (creator) > member row > "anyone in the team"
 *   artifact:  highest of the inherited work-item role, an artifact member
 *              row, and the artifact's own general access. It only ever adds
 *              to the work item's access, so it cannot hide from members.
 *
 * "Team" is the work item's org, checked against org_memberships — never the
 * caller's token claims.
 */

export type AccessRole = 'view' | 'edit' | 'author';
export type MemberRole = Exclude<AccessRole, 'author'>;
export type WorkItemGeneralAccess = 'invited' | 'team';
export type ArtifactGeneralAccess = WorkItemGeneralAccess | 'link';

export interface WorkItemAccess {
  role: AccessRole;
  source: 'author' | 'member' | 'team';
  work_item_id: string;
}

export interface ArtifactAccess {
  role: AccessRole;
  work_item_id: string;
  /** The role inherited from the work item; null = access to this artifact alone. */
  work_item_role: AccessRole | null;
}

const ROLE_RANK: Record<AccessRole, number> = { view: 1, edit: 2, author: 3 };

export function roleAtLeast(role: AccessRole, minimum: AccessRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

function higherRole(a: AccessRole | null, b: AccessRole | null): AccessRole | null {
  if (!a) return b;
  if (!b) return a;
  return ROLE_RANK[a] >= ROLE_RANK[b] ? a : b;
}

function parseMemberRole(value: string | null): MemberRole | null {
  if (value === null) return null;
  if (value === 'view' || value === 'edit') return value;
  throw new Error(`[access] unknown member role: ${value}`);
}

interface WorkItemAccessRow {
  work_item_id: string;
  creator_id: string;
  general_access: string;
  general_role: string;
  member_role: string | null;
  org_member_id: string | null;
}

function computeWorkItemAccess(row: WorkItemAccessRow, userId: string): WorkItemAccess | null {
  if (row.creator_id === userId) {
    return { role: 'author', source: 'author', work_item_id: row.work_item_id };
  }
  const memberRole = parseMemberRole(row.member_role);
  const teamRole =
    row.general_access === 'team' && row.org_member_id ? parseMemberRole(row.general_role) : null;
  const role = higherRole(memberRole, teamRole);
  if (!role) return null;
  return {
    role,
    source: memberRole === role ? 'member' : 'team',
    work_item_id: row.work_item_id,
  };
}

const workItemMember = alias(resourceMembers, 'work_item_member');
const artifactMember = alias(resourceMembers, 'artifact_member');

export async function resolveWorkItemAccess(
  userId: string,
  workItemId: string
): Promise<WorkItemAccess | 'not_found' | null> {
  const cached = readCachedAccess<WorkItemAccess | null>('work_item', workItemId, userId);
  if (cached !== undefined) return cached;

  const [row] = await db
    .select({
      work_item_id: workItems.id,
      creator_id: workItems.creator_id,
      general_access: workItems.general_access,
      general_role: workItems.general_role,
      member_role: workItemMember.role,
      org_member_id: orgMemberships.user_id,
    })
    .from(workItems)
    .leftJoin(
      workItemMember,
      and(
        eq(workItemMember.work_item_id, workItems.id),
        isNull(workItemMember.artifact_id),
        eq(workItemMember.user_id, userId)
      )
    )
    .leftJoin(
      orgMemberships,
      and(eq(orgMemberships.org_id, workItems.org_id), eq(orgMemberships.user_id, userId))
    )
    .where(eq(workItems.id, workItemId))
    .limit(1);

  if (!row) return 'not_found';
  const access = computeWorkItemAccess(row, userId);
  writeCachedAccess('work_item', workItemId, userId, workItemId, access);
  return access;
}

/** An artifact with everything that decides one user's access to it. */
export interface ArtifactAccessRow extends WorkItemAccessRow {
  artifact_id: string;
  artifact_general_access: string;
  artifact_general_role: string;
  artifact_member_role: string | null;
  name: string;
  content_type: string;
  render_class: string;
  updated_at: Date;
  work_item_name: string;
}

/**
 * Which artifacts to read: one by id, or every artifact another author's
 * work item could have shared with the user on its own (an artifact member
 * row, or team / link access in the user's team). Both run as ONE query, so
 * a list computes access per row without a query per row.
 */
export type ArtifactAccessQuery =
  | { artifactId: string }
  | { workItemId: string }
  | { sharedWithUser: true };

export async function queryArtifactAccessRows(
  userId: string,
  query: ArtifactAccessQuery
): Promise<ArtifactAccessRow[]> {
  const where =
    'artifactId' in query
      ? eq(artifacts.id, query.artifactId)
      : 'workItemId' in query
        ? eq(artifacts.work_item_id, query.workItemId)
        : and(
            ne(workItems.creator_id, userId),
            or(
              isNotNull(artifactMember.id),
              and(
                isNotNull(orgMemberships.user_id),
                inArray(artifacts.general_access, ['team', 'link'])
              )
            )
          );

  return db
    .select({
      work_item_id: workItems.id,
      creator_id: workItems.creator_id,
      general_access: workItems.general_access,
      general_role: workItems.general_role,
      member_role: workItemMember.role,
      org_member_id: orgMemberships.user_id,
      artifact_id: artifacts.id,
      artifact_general_access: artifacts.general_access,
      artifact_general_role: artifacts.general_role,
      artifact_member_role: artifactMember.role,
      name: artifacts.name,
      content_type: artifacts.content_type,
      render_class: artifacts.render_class,
      updated_at: artifacts.updated_at,
      work_item_name: workItems.name,
    })
    .from(artifacts)
    .innerJoin(workItems, eq(workItems.id, artifacts.work_item_id))
    .leftJoin(
      workItemMember,
      and(
        eq(workItemMember.work_item_id, workItems.id),
        isNull(workItemMember.artifact_id),
        eq(workItemMember.user_id, userId)
      )
    )
    .leftJoin(
      artifactMember,
      and(eq(artifactMember.artifact_id, artifacts.id), eq(artifactMember.user_id, userId))
    )
    .leftJoin(
      orgMemberships,
      and(eq(orgMemberships.org_id, workItems.org_id), eq(orgMemberships.user_id, userId))
    )
    .where(where)
    .orderBy(desc(artifacts.updated_at));
}

export function computeArtifactAccess(
  row: ArtifactAccessRow,
  userId: string
): ArtifactAccess | null {
  const inherited = computeWorkItemAccess(row, userId)?.role ?? null;
  let generalRole: AccessRole | null = null;
  if (row.org_member_id && row.artifact_general_access === 'team') {
    generalRole = parseMemberRole(row.artifact_general_role);
  } else if (row.org_member_id && row.artifact_general_access === 'link') {
    // A public link is reached by token (/p/:token); by id it is view for the team.
    generalRole = 'view';
  }
  const role = higherRole(
    inherited,
    higherRole(parseMemberRole(row.artifact_member_role), generalRole)
  );
  return role ? { role, work_item_id: row.work_item_id, work_item_role: inherited } : null;
}

/**
 * The artifacts of a work item the user reaches without reaching the work
 * item: shared with them alone, or open to their team on the artifact's own
 * general access. Empty for anyone who reaches the work item, and for anyone
 * who reaches nothing. One query.
 */
export async function listArtifactsReachableAlone(
  userId: string,
  workItemId: string
): Promise<string[]> {
  const rows = await queryArtifactAccessRows(userId, { workItemId });
  return rows
    .filter((row) => {
      const access = computeArtifactAccess(row, userId);
      return access !== null && access.work_item_role === null;
    })
    .map((row) => row.artifact_id);
}

export async function resolveArtifactAccess(
  userId: string,
  artifactId: string
): Promise<ArtifactAccess | 'not_found' | null> {
  const cached = readCachedAccess<ArtifactAccess | null>('artifact', artifactId, userId);
  if (cached !== undefined) return cached;

  const [row] = await queryArtifactAccessRows(userId, { artifactId });
  if (!row) return 'not_found';

  const access = computeArtifactAccess(row, userId);
  writeCachedAccess('artifact', artifactId, userId, row.work_item_id, access);
  return access;
}
