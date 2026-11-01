import { eq, inArray, max, sql } from 'drizzle-orm';
import { db } from '@main/db/client';
import { artifactComments, artifacts, artifactVersions } from '@main/db/schema-artifacts';

export interface LocalRailSummaryRow {
  artifactId: string;
  /** Unresolved threads kept on this device: root comments, as the comments card counts them. */
  openComments: number;
  /** The newest version on this device, as the Versions card lists them; null without versions. */
  latestVersion: number | null;
}

/**
 * The device's half of the rail's counts (shared-items step 1, S8), for every
 * artifact of a work item in one grouped read. Comments here are only the
 * store of artifacts that never synced (artifact-comments-store.ts); the
 * renderer decides per artifact which store's count it shows.
 */
export function listLocalRailSummary(workItemId: string): LocalRailSummaryRow[] {
  const workItemArtifactIds = db
    .select({ id: artifacts.id })
    .from(artifacts)
    .where(eq(artifacts.workItemId, workItemId));
  // Versions are grouped on their own so their rows never multiply the
  // comment rows the count is taken over.
  const latest = db
    .select({
      artifactId: artifactVersions.artifactId,
      latestVersion: max(artifactVersions.versionNumber).as('latest_version'),
    })
    .from(artifactVersions)
    .where(inArray(artifactVersions.artifactId, workItemArtifactIds))
    .groupBy(artifactVersions.artifactId)
    .as('latest');

  return (
    db
      .select({
        artifactId: artifacts.id,
        openComments: sql<number>`coalesce(sum(case when ${artifactComments.parentCommentId} is null and ${artifactComments.resolved} = 0 then 1 else 0 end), 0)`,
        latestVersion: latest.latestVersion,
      })
      .from(artifacts)
      .leftJoin(artifactComments, eq(artifactComments.artifactId, artifacts.id))
      .leftJoin(latest, eq(latest.artifactId, artifacts.id))
      .where(eq(artifacts.workItemId, workItemId))
      // One `latest` row per artifact, so grouping by the artifact alone keeps
      // its version (SQLite takes a bare column from the group's rows).
      .groupBy(artifacts.id)
      .all()
  );
}
