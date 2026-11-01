import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '../db/client.js';
import { resourceMembers } from '../db/schema-sharing.js';
import { orgMemberships, workItems } from '../db/schema.js';
import { invalidateWorkItemAccess } from './access-cache.js';
import type { MemberRole } from './resolve-access.js';

const existingMember = alias(resourceMembers, 'existing_member');

/** A share that just reached its invitee: what was shared, as what, and by whom. */
export interface ActivatedMember {
  work_item_id: string;
  artifact_id: string | null;
  role: MemberRole;
  granted_by: string;
}

function memberRoleOf(role: string, memberId: string): MemberRole {
  if (role !== 'view' && role !== 'edit') {
    throw new Error(`resource member ${memberId} has an unknown role: ${role}`);
  }
  return role;
}

/**
 * Turns pending (email-keyed) member rows into real members once the invitee
 * belongs to the work item's team. Called wherever a team membership is
 * created — sign-up (sync-profile) and accepting a team invite. A pending row
 * whose person already holds a member row for the same resource is dropped:
 * the existing row, set deliberately later, wins. Returns the shares that
 * now reach the invitee, for the caller to announce (announceActivatedMembers).
 */
export async function activatePendingMembers(
  userId: string,
  email: string
): Promise<ActivatedMember[]> {
  const normalizedEmail = email.toLowerCase();
  const teamWorkItems = db
    .select({ id: workItems.id })
    .from(workItems)
    .innerJoin(
      orgMemberships,
      and(eq(orgMemberships.org_id, workItems.org_id), eq(orgMemberships.user_id, userId))
    );

  const pending = await db
    .select({
      id: resourceMembers.id,
      work_item_id: resourceMembers.work_item_id,
      artifact_id: resourceMembers.artifact_id,
      role: resourceMembers.role,
      granted_by: resourceMembers.granted_by,
      duplicate_id: existingMember.id,
    })
    .from(resourceMembers)
    .leftJoin(
      existingMember,
      and(
        eq(existingMember.work_item_id, resourceMembers.work_item_id),
        sql`${existingMember.artifact_id} is not distinct from ${resourceMembers.artifact_id}`,
        eq(existingMember.user_id, userId)
      )
    )
    .where(
      and(
        isNull(resourceMembers.user_id),
        eq(sql`lower(${resourceMembers.invited_email})`, normalizedEmail),
        inArray(resourceMembers.work_item_id, teamWorkItems)
      )
    );

  if (pending.length === 0) return [];

  const toActivate = pending.filter((row) => !row.duplicate_id).map((row) => row.id);
  const toDrop = pending.filter((row) => row.duplicate_id).map((row) => row.id);

  if (toDrop.length > 0) {
    await db.delete(resourceMembers).where(inArray(resourceMembers.id, toDrop));
  }
  if (toActivate.length > 0) {
    await db
      .update(resourceMembers)
      .set({ user_id: userId, invited_email: null })
      .where(inArray(resourceMembers.id, toActivate));
  }

  for (const workItemId of new Set(pending.map((row) => row.work_item_id))) {
    invalidateWorkItemAccess(workItemId);
  }
  return pending
    .filter((row) => !row.duplicate_id)
    .map((row) => ({
      work_item_id: row.work_item_id,
      artifact_id: row.artifact_id,
      role: memberRoleOf(row.role, row.id),
      granted_by: row.granted_by,
    }));
}
