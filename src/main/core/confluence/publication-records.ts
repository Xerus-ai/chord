import { and, desc, eq } from 'drizzle-orm';
import type { ConfluencePublicationStatus } from '@shared/confluence';
import { insertArtifactVersion } from '@main/core/artifacts/save-artifact-version';
import { db } from '@main/db/client';
import { artifactVersions } from '@main/db/schema-artifacts';
import { confluencePublications, type ConfluencePublicationRow } from '@main/db/schema-confluence';

export const PUBLISHED_VERSION_LABEL = 'Published to Confluence';

/**
 * The artifact version a publish shows: the latest version when it already
 * holds exactly this content, otherwise a new version labelled "Published to
 * Confluence". Either way "Published vN" names a version the History tab has.
 */
export function ensurePublishedVersion(args: {
  artifactId: string;
  content: string;
  authorName: string;
}): number {
  const [latest] = db
    .select({ versionNumber: artifactVersions.versionNumber, content: artifactVersions.content })
    .from(artifactVersions)
    .where(eq(artifactVersions.artifactId, args.artifactId))
    .orderBy(desc(artifactVersions.versionNumber))
    .limit(1)
    .all();
  if (latest && latest.content === args.content) return latest.versionNumber;

  const saved = insertArtifactVersion({
    artifactId: args.artifactId,
    content: args.content,
    trigger: 'manual',
    label: PUBLISHED_VERSION_LABEL,
    authorName: args.authorName,
    baseVersion: null,
  });
  if (saved.status !== 'saved')
    throw new Error('An unconditional version save reported a conflict');
  return saved.version.versionNumber;
}

export function readPublishedContent(artifactId: string, versionNumber: number): string {
  const [row] = db
    .select({ content: artifactVersions.content })
    .from(artifactVersions)
    .where(
      and(
        eq(artifactVersions.artifactId, artifactId),
        eq(artifactVersions.versionNumber, versionNumber)
      )
    )
    .limit(1)
    .all();
  if (!row) throw new Error(`Artifact ${artifactId} has no version ${versionNumber}`);
  return row.content;
}

export function findPublication(artifactId: string): ConfluencePublicationRow | null {
  const [row] = db
    .select()
    .from(confluencePublications)
    .where(eq(confluencePublications.artifactId, artifactId))
    .limit(1)
    .all();
  return row ?? null;
}

/** One row per artifact: the first publish inserts it, every republish moves it on. */
export function recordPublication(
  publication: Omit<ConfluencePublicationRow, 'publishedAt'>
): ConfluencePublicationRow {
  const row = { ...publication, publishedAt: Math.floor(Date.now() / 1000) };
  db.insert(confluencePublications)
    .values(row)
    .onConflictDoUpdate({ target: confluencePublications.artifactId, set: row })
    .run();
  return row;
}

export function buildPageUrl(siteUrl: string, pageId: string): string {
  return `${siteUrl}/wiki/pages/viewpage.action?pageId=${encodeURIComponent(pageId)}`;
}

/**
 * Status from what was recorded and what is true now. An edit made in
 * Confluence outranks a change in Chord: updating would overwrite it, so the
 * person has to see that first.
 */
export function describePublicationState(args: {
  publication: ConfluencePublicationRow;
  siteUrl: string;
  remoteVersion: number;
  currentContent: string;
  publishedContent: string;
}): ConfluencePublicationStatus {
  const { publication } = args;
  const state =
    args.remoteVersion > publication.confluenceVersion
      ? 'edited_in_confluence'
      : args.currentContent !== args.publishedContent
        ? 'out_of_date'
        : 'published';
  return {
    state,
    pageId: publication.pageId,
    spaceKey: publication.spaceKey,
    pageUrl: buildPageUrl(args.siteUrl, publication.pageId),
    publishedArtifactVersion: publication.publishedArtifactVersion,
    confluenceVersion: publication.confluenceVersion,
    remoteVersion: args.remoteVersion,
  };
}
