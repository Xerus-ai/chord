import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { chordAccountService } from '@main/core/account/services/chord-account-service';
import { db } from '@main/db/client';
import { artifactVersions } from '@main/db/schema-artifacts';
import type { ArtifactVersionTrigger } from './artifact-utils';

/**
 * Author identity for a locally stored row comes from the signed-in Chord
 * account — the same identity the cloud store stamps its rows with — so an
 * author is never a placeholder and never renderer-supplied. Null means there
 * is no signed-in account, which callers must surface rather than paper over.
 */
export async function resolveArtifactAuthorName(): Promise<string | null> {
  const { user } = await chordAccountService.getSession();
  if (!user) return null;
  return user.username || user.email;
}

export type ArtifactVersionRow = typeof artifactVersions.$inferSelect;

/**
 * The content of the artifact's latest version, or null when it has none —
 * what a republish of a page rebinds its element ids against
 * (artifact-pages/stamp-published-page.ts).
 */
export function readLatestArtifactVersionContent(artifactId: string): string | null {
  const [latest] = db
    .select({ content: artifactVersions.content })
    .from(artifactVersions)
    .where(eq(artifactVersions.artifactId, artifactId))
    .orderBy(desc(artifactVersions.versionNumber))
    .limit(1)
    .all();
  return latest?.content ?? null;
}

export type InsertArtifactVersionResult =
  | { status: 'saved'; version: ArtifactVersionRow }
  | { status: 'conflict'; latestVersion: number };

/**
 * Appends the next version of an artifact, attributed to `authorName`.
 *
 * `baseVersion` is the version number the content was made on top of (0 for an
 * artifact with no versions yet). When a newer version has landed since, the
 * save is refused with `conflict` rather than interleaved — two people saving
 * on the same base no longer silently number past each other. `null` appends
 * unconditionally; only in-place page edits pass it, because they patch one
 * element of the file as it is now (per-element last-write-wins, plan P1b.2).
 * The read and the insert run in one synchronous transaction, so no other
 * save can land between the check and the write.
 */
export function insertArtifactVersion(args: {
  artifactId: string;
  content: string;
  trigger: ArtifactVersionTrigger;
  label?: string;
  authorName: string;
  baseVersion: number | null;
}): InsertArtifactVersionResult {
  return db.transaction((tx) => {
    const [latest] = tx
      .select({ versionNumber: artifactVersions.versionNumber })
      .from(artifactVersions)
      .where(eq(artifactVersions.artifactId, args.artifactId))
      .orderBy(desc(artifactVersions.versionNumber))
      .limit(1)
      .all();
    const latestVersion = latest?.versionNumber ?? 0;
    if (args.baseVersion !== null && args.baseVersion !== latestVersion) {
      return { status: 'conflict' as const, latestVersion };
    }

    const id = randomUUID();
    tx.insert(artifactVersions)
      .values({
        id,
        artifactId: args.artifactId,
        versionNumber: latestVersion + 1,
        authorName: args.authorName,
        label: args.label ?? null,
        content: args.content,
        byteSize: new TextEncoder().encode(args.content).length,
        trigger: args.trigger,
        createdAt: Math.floor(Date.now() / 1000),
      })
      .run();
    const [row] = tx.select().from(artifactVersions).where(eq(artifactVersions.id, id)).all();
    return { status: 'saved' as const, version: row! };
  });
}
