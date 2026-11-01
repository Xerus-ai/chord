import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { recordAccessEvent } from '../../access/record-access-event.js';
import {
  buildShareLinkUrl,
  deriveShareLinkToken,
  hashShareLinkToken,
} from '../../access/share-link-tokens.js';
import { db } from '../../db/client.js';
import { shareLinks } from '../../db/schema-sharing.js';
import { organizations } from '../../db/schema.js';

/** The live public link of an artifact, as the author sees it. */
export interface ShareLinkView {
  url: string;
  comments_enabled: boolean;
}

export async function findLiveShareLink(
  artifactId: string
): Promise<{ id: string; comments_enabled: boolean } | null> {
  const [link] = await db
    .select({ id: shareLinks.id, comments_enabled: shareLinks.comments_enabled })
    .from(shareLinks)
    .where(and(eq(shareLinks.artifact_id, artifactId), isNull(shareLinks.revoked_at)))
    .limit(1);
  return link ?? null;
}

export function toShareLinkView(link: { id: string; comments_enabled: boolean }): ShareLinkView {
  return { url: buildShareLinkUrl(link.id), comments_enabled: link.comments_enabled };
}

export async function teamAllowsPublicLinks(orgId: string): Promise<boolean> {
  const [org] = await db
    .select({ allow: organizations.allow_public_links })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  if (!org) throw new Error(`[sharing] organization vanished mid-request: ${orgId}`);
  return org.allow;
}

/** Creates the artifact's live link unless it has one. Returns the live link. */
export async function ensureShareLink(
  workItemId: string,
  artifactId: string,
  actorId: string
): Promise<{ id: string; comments_enabled: boolean }> {
  const existing = await findLiveShareLink(artifactId);
  if (existing) return existing;

  const id = randomUUID();
  await db.insert(shareLinks).values({
    id,
    artifact_id: artifactId,
    work_item_id: workItemId,
    token_hash: hashShareLinkToken(deriveShareLinkToken(id)),
    created_by: actorId,
  });
  await recordAccessEvent({ workItemId, artifactId, actorId, action: 'link_created' });
  return { id, comments_enabled: true };
}

/** Revokes the artifact's live link, if any. A revoked link never works again. */
export async function revokeShareLink(
  workItemId: string,
  artifactId: string,
  actorId: string
): Promise<void> {
  const revoked = await db
    .update(shareLinks)
    .set({ revoked_at: new Date() })
    .where(and(eq(shareLinks.artifact_id, artifactId), isNull(shareLinks.revoked_at)))
    .returning({ id: shareLinks.id });
  if (revoked.length > 0) {
    await recordAccessEvent({ workItemId, artifactId, actorId, action: 'link_revoked' });
  }
}
