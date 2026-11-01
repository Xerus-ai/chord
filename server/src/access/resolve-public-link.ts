import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { artifacts } from '../db/schema-artifacts.js';
import { shareLinks } from '../db/schema-sharing.js';
import { organizations, workItems } from '../db/schema.js';
import { hashShareLinkToken } from './share-link-tokens.js';

export interface PublicLinkTarget {
  linkId: string;
  commentsEnabled: boolean;
  artifactId: string;
  workItemId: string;
  name: string;
  contentType: string;
  renderClass: string;
}

/**
 * The one decision for "Anyone with the link" (P6): the token must hash to a
 * live (unrevoked) link, the artifact must still be set to 'link', and the
 * team must still allow public links. Anything else is null — the caller
 * answers 404 and discloses nothing about whether the artifact exists.
 */
export async function resolvePublicLink(token: string): Promise<PublicLinkTarget | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;

  const [row] = await db
    .select({
      linkId: shareLinks.id,
      commentsEnabled: shareLinks.comments_enabled,
      artifactId: artifacts.id,
      workItemId: artifacts.work_item_id,
      name: artifacts.name,
      contentType: artifacts.content_type,
      renderClass: artifacts.render_class,
    })
    .from(shareLinks)
    .innerJoin(artifacts, eq(artifacts.id, shareLinks.artifact_id))
    .innerJoin(workItems, eq(workItems.id, artifacts.work_item_id))
    .innerJoin(organizations, eq(organizations.id, workItems.org_id))
    .where(
      and(
        eq(shareLinks.token_hash, hashShareLinkToken(token)),
        isNull(shareLinks.revoked_at),
        eq(artifacts.general_access, 'link'),
        eq(organizations.allow_public_links, true)
      )
    )
    .limit(1);

  return row ?? null;
}
