import type { ArtifactsOnlyWorkItem, WorkItemOwner } from '@chord/protocol';
import { eq, inArray } from 'drizzle-orm';
import {
  computeArtifactAccess,
  queryArtifactAccessRows,
  type ArtifactAccessQuery,
} from '../access/resolve-access.js';
import { db } from '../db/client.js';
import { users, workItems } from '../db/schema.js';

type SharedArtifact = ArtifactsOnlyWorkItem['shared_artifacts'][number];

/** Each work item's owner, for the teammate's app to name and picture. One query. */
export async function readWorkItemOwners(ids: string[]): Promise<Map<string, WorkItemOwner>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      work_item_id: workItems.id,
      creator_id: workItems.creator_id,
      creator_name: users.name,
      creator_email: users.email,
      creator_avatar_url: users.avatar_url,
    })
    .from(workItems)
    .innerJoin(users, eq(users.id, workItems.creator_id))
    .where(inArray(workItems.id, ids));
  return new Map(rows.map(({ work_item_id, ...owner }) => [work_item_id, owner]));
}

export function ownerOf(owners: Map<string, WorkItemOwner>, workItemId: string): WorkItemOwner {
  const owner = owners.get(workItemId);
  if (!owner) throw new Error(`[work-items] ${workItemId} has no readable owner`);
  return owner;
}

/**
 * The artifacts shared with the user without their work item, by work item:
 * a member row on the artifact, or the artifact open to the user's team. A
 * public link is for people outside the team (design D2) and shares nothing.
 * One query.
 */
export async function listArtifactsSharedAlone(
  userId: string,
  query: Exclude<ArtifactAccessQuery, { artifactId: string }>
): Promise<Map<string, SharedArtifact[]>> {
  const rows = await queryArtifactAccessRows(userId, query);
  const byWorkItem = new Map<string, SharedArtifact[]>();
  for (const row of rows) {
    const access = computeArtifactAccess(row, userId);
    if (access === null || access.work_item_role !== null) continue;
    const shared =
      row.artifact_member_role !== null ||
      (row.org_member_id !== null && row.artifact_general_access === 'team');
    if (!shared) continue;
    const list = byWorkItem.get(row.work_item_id) ?? [];
    list.push({ id: row.artifact_id, name: row.name });
    byWorkItem.set(row.work_item_id, list);
  }
  return byWorkItem;
}

/** The header of each work item reached only through artifacts shared alone. One query. */
export async function readArtifactsOnlyHeaders(
  shared: Map<string, SharedArtifact[]>
): Promise<ArtifactsOnlyWorkItem[]> {
  if (shared.size === 0) return [];
  const rows = await db
    .select({
      id: workItems.id,
      org_id: workItems.org_id,
      name: workItems.name,
      status: workItems.status,
      repo_name: workItems.repo_name,
      repo_remote_url: workItems.repo_remote_url,
      updated_at: workItems.updated_at,
      version_number: workItems.version_number,
      creator_id: workItems.creator_id,
      creator_name: users.name,
      creator_email: users.email,
      creator_avatar_url: users.avatar_url,
    })
    .from(workItems)
    .innerJoin(users, eq(users.id, workItems.creator_id))
    .where(inArray(workItems.id, [...shared.keys()]));
  return rows.map((row) => ({
    ...row,
    updated_at: row.updated_at.toISOString(),
    access_scope: 'artifacts' as const,
    shared_artifacts: shared.get(row.id)!,
  }));
}
