import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { resourceMembers } from '../db/schema-sharing.js';
import { orgMemberships, workItems } from '../db/schema.js';

/**
 * Every user with access to the work item itself: the author, its members,
 * and — when the item is open to the team — every member of its org.
 * Artifact-only members are not part of it: they never reach chat or
 * notifications about the work item.
 */
export async function listWorkItemAudience(workItemId: string): Promise<string[]> {
  const [item] = await db
    .select({
      creator_id: workItems.creator_id,
      org_id: workItems.org_id,
      general_access: workItems.general_access,
    })
    .from(workItems)
    .where(eq(workItems.id, workItemId))
    .limit(1);
  if (!item) return [];

  const members = await db
    .select({ user_id: resourceMembers.user_id })
    .from(resourceMembers)
    .where(
      and(
        eq(resourceMembers.work_item_id, workItemId),
        isNull(resourceMembers.artifact_id),
        isNotNull(resourceMembers.user_id)
      )
    );
  const team =
    item.general_access === 'team'
      ? await db
          .select({ user_id: orgMemberships.user_id })
          .from(orgMemberships)
          .where(eq(orgMemberships.org_id, item.org_id))
      : [];

  const audience = new Set<string>([item.creator_id]);
  for (const row of [...members, ...team]) if (row.user_id) audience.add(row.user_id);
  return [...audience];
}

/**
 * The author and the work item's active members — the people it was
 * deliberately shared with. Chat relay and "new message" notifications go to
 * them only; team access alone does not subscribe a whole org to every
 * message.
 */
export async function listWorkItemPrincipals(workItemId: string): Promise<string[]> {
  const [item] = await db
    .select({ creator_id: workItems.creator_id })
    .from(workItems)
    .where(eq(workItems.id, workItemId))
    .limit(1);
  if (!item) return [];
  const members = await db
    .select({ user_id: resourceMembers.user_id })
    .from(resourceMembers)
    .where(
      and(
        eq(resourceMembers.work_item_id, workItemId),
        isNull(resourceMembers.artifact_id),
        isNotNull(resourceMembers.user_id)
      )
    );
  const principals = new Set<string>([item.creator_id]);
  for (const row of members) if (row.user_id) principals.add(row.user_id);
  return [...principals];
}
