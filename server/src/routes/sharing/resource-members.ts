import { and, eq, isNotNull, isNull, notExists, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { MemberRole } from '../../access/resolve-access.js';
import { db } from '../../db/client.js';
import { artifacts } from '../../db/schema-artifacts.js';
import { resourceMembers } from '../../db/schema-sharing.js';
import { organizations, users, workItems } from '../../db/schema.js';
import type { ResourceRef } from './resource-scope.js';

/** Reads shared by the member, general-access and sharing-state routes. */

export interface MemberView {
  id: string;
  user_id: string | null;
  email: string;
  name: string | null;
  avatar_url: string | null;
  role: MemberRole;
  /** Invited from outside the team; becomes a member when they join it. */
  pending: boolean;
}

/** Someone only some of a work item's artifacts were shared with, and which. */
export interface ArtifactOnlyMemberView {
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

export interface ResourceContext {
  orgId: string;
  authorId: string;
  name: string;
}

/** Rows of exactly this resource: the work item's own members, or one artifact's. */
export function membersOf(ref: ResourceRef): SQL {
  const scope = ref.artifactId
    ? eq(resourceMembers.artifact_id, ref.artifactId)
    : isNull(resourceMembers.artifact_id);
  return and(eq(resourceMembers.work_item_id, ref.workItemId), scope)!;
}

/** The work item's team, by id and name. */
export async function loadTeam(orgId: string): Promise<{ id: string; name: string }> {
  const [team] = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  if (!team) throw new Error(`[sharing] organization vanished mid-request: ${orgId}`);
  return team;
}

export async function loadResourceContext(ref: ResourceRef): Promise<ResourceContext> {
  const [item] = await db
    .select({ org_id: workItems.org_id, creator_id: workItems.creator_id, name: workItems.name })
    .from(workItems)
    .where(eq(workItems.id, ref.workItemId))
    .limit(1);
  if (!item) throw new Error(`[sharing] work item vanished mid-request: ${ref.workItemId}`);
  if (!ref.artifactId) return { orgId: item.org_id, authorId: item.creator_id, name: item.name };

  const [artifact] = await db
    .select({ name: artifacts.name })
    .from(artifacts)
    .where(eq(artifacts.id, ref.artifactId))
    .limit(1);
  if (!artifact) throw new Error(`[sharing] artifact vanished mid-request: ${ref.artifactId}`);
  return { orgId: item.org_id, authorId: item.creator_id, name: artifact.name };
}

export async function listMembers(ref: ResourceRef): Promise<MemberView[]> {
  const rows = await db
    .select({
      id: resourceMembers.id,
      user_id: resourceMembers.user_id,
      invited_email: resourceMembers.invited_email,
      role: resourceMembers.role,
      email: users.email,
      name: users.name,
      avatar_url: users.avatar_url,
    })
    .from(resourceMembers)
    .leftJoin(users, eq(users.id, resourceMembers.user_id))
    .where(membersOf(ref))
    .orderBy(resourceMembers.created_at);
  return rows.map(toMemberView);
}

const workItemMember = alias(resourceMembers, 'work_item_member');

/**
 * The people a work item's artifacts were shared with alone: artifact member
 * rows of anyone who is not also a member of the work item itself (they are
 * listed with it). One query; one entry per person, artifacts in the order
 * they were shared.
 */
export async function listArtifactOnlyMembers(
  workItemId: string
): Promise<ArtifactOnlyMemberView[]> {
  const rows = await db
    .select({
      id: resourceMembers.id,
      user_id: resourceMembers.user_id,
      invited_email: resourceMembers.invited_email,
      role: resourceMembers.role,
      email: users.email,
      name: users.name,
      avatar_url: users.avatar_url,
      artifact_id: artifacts.id,
      artifact_name: artifacts.name,
    })
    .from(resourceMembers)
    .innerJoin(artifacts, eq(artifacts.id, resourceMembers.artifact_id))
    .leftJoin(users, eq(users.id, resourceMembers.user_id))
    .where(
      and(
        eq(resourceMembers.work_item_id, workItemId),
        isNotNull(resourceMembers.artifact_id),
        notExists(
          db
            .select({ id: workItemMember.id })
            .from(workItemMember)
            .where(
              and(
                eq(workItemMember.work_item_id, resourceMembers.work_item_id),
                isNull(workItemMember.artifact_id),
                eq(workItemMember.user_id, resourceMembers.user_id)
              )
            )
        )
      )
    )
    .orderBy(resourceMembers.created_at);

  const byPerson = new Map<string, ArtifactOnlyMemberView>();
  for (const row of rows) {
    const member = toMemberView(row);
    const key = member.user_id ?? `pending:${member.email.toLowerCase()}`;
    const person = byPerson.get(key) ?? {
      user_id: member.user_id,
      email: member.email,
      name: member.name,
      avatar_url: member.avatar_url,
      pending: member.pending,
      artifacts: [],
    };
    person.artifacts.push({
      member_id: member.id,
      artifact_id: row.artifact_id,
      artifact_name: row.artifact_name,
      role: member.role,
    });
    byPerson.set(key, person);
  }
  return [...byPerson.values()];
}

export async function findMember(ref: ResourceRef, memberId: string): Promise<MemberView | null> {
  const [row] = await db
    .select({
      id: resourceMembers.id,
      user_id: resourceMembers.user_id,
      invited_email: resourceMembers.invited_email,
      role: resourceMembers.role,
      email: users.email,
      name: users.name,
      avatar_url: users.avatar_url,
    })
    .from(resourceMembers)
    .leftJoin(users, eq(users.id, resourceMembers.user_id))
    .where(and(membersOf(ref), eq(resourceMembers.id, memberId)))
    .limit(1);
  return row ? toMemberView(row) : null;
}

export async function findUserByEmail(
  email: string
): Promise<{ id: string; email: string; name: string | null } | null> {
  const [user] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(sql`lower(${users.email})`, email.toLowerCase()))
    .limit(1);
  return user ?? null;
}

function toMemberView(row: {
  id: string;
  user_id: string | null;
  invited_email: string | null;
  role: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
}): MemberView {
  if (row.role !== 'view' && row.role !== 'edit') {
    throw new Error(`[sharing] unknown member role: ${row.role}`);
  }
  const email = row.email ?? row.invited_email;
  if (!email) throw new Error(`[sharing] member ${row.id} has no email`);
  return {
    id: row.id,
    user_id: row.user_id,
    email,
    name: row.name,
    avatar_url: row.avatar_url,
    role: row.role,
    pending: row.user_id === null,
  };
}
