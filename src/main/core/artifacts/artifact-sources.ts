import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { asc, eq, inArray } from 'drizzle-orm';
import type { ArtifactSourceDrift, ChangedSource } from '@shared/artifact-source-drift';
import { db } from '@main/db/client';
import { artifactSources, type ArtifactSourceRow } from '@main/db/schema-artifact-sources';
import { listWorkItemArtifactRows } from './find-artifact-by-path';

/**
 * Drift between an artifact and the files it was written from (plan
 * 2026-09-23 §4 P4 step 2). Each source's content hash is recorded when the
 * artifact is published; the artifact is out of date while any source's hash
 * on disk differs. Drift is decided by content, not mtime, so a rewrite with
 * identical bytes is not drift.
 */

/** SHA-256 of a source file, or null when the file no longer exists (a deleted source). */
function hashSourceFile(path: string): string | null {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function describeChange(row: ArtifactSourceRow): ChangedSource | null {
  const hash = hashSourceFile(row.path);
  if (hash === null) return { path: row.path, change: 'deleted' };
  return hash === row.contentHash ? null : { path: row.path, change: 'modified' };
}

/** Replaces an artifact's source list with `paths`, hashed as they are now. */
export function replaceArtifactSources(artifactId: string, paths: readonly string[]): void {
  const rows = paths.map((path) => {
    const contentHash = hashSourceFile(path);
    if (contentHash === null) throw new Error(`Source file does not exist: ${path}`);
    return { artifactId, path, contentHash };
  });
  db.transaction((tx) => {
    tx.delete(artifactSources).where(eq(artifactSources.artifactId, artifactId)).run();
    if (rows.length > 0) tx.insert(artifactSources).values(rows).run();
  });
}

/**
 * Advances every source's baseline to its current content — a republish, or
 * a person marking the drift reviewed. A source that has been deleted is
 * dropped from the list: the deletion is what was reviewed.
 */
export function rebaselineArtifactSources(artifactId: string): void {
  const rows = db
    .select()
    .from(artifactSources)
    .where(eq(artifactSources.artifactId, artifactId))
    .all();
  const current = rows.map((row) => ({ path: row.path, contentHash: hashSourceFile(row.path) }));
  db.transaction((tx) => {
    tx.delete(artifactSources).where(eq(artifactSources.artifactId, artifactId)).run();
    const kept = current.filter(
      (row): row is { path: string; contentHash: string } => row.contentHash !== null
    );
    if (kept.length > 0) {
      tx.insert(artifactSources)
        .values(kept.map((row) => ({ artifactId, ...row })))
        .run();
    }
  });
}

export function listChangedSources(artifactId: string): ChangedSource[] {
  return db
    .select()
    .from(artifactSources)
    .where(eq(artifactSources.artifactId, artifactId))
    .orderBy(asc(artifactSources.path))
    .all()
    .map(describeChange)
    .filter((change): change is ChangedSource => change !== null);
}

function listWorkItemSourceRows(workItemId: string) {
  const artifactRows = listWorkItemArtifactRows(workItemId);
  if (artifactRows.length === 0) return { artifactRows, sourceRows: [] };
  const sourceRows = db
    .select()
    .from(artifactSources)
    .where(
      inArray(
        artifactSources.artifactId,
        artifactRows.map((row) => row.id)
      )
    )
    .orderBy(asc(artifactSources.path))
    .all();
  return { artifactRows, sourceRows };
}

/** The work item's out-of-date artifacts, each with the sources that changed. */
export function listWorkItemSourceDrift(workItemId: string): ArtifactSourceDrift[] {
  const { artifactRows, sourceRows } = listWorkItemSourceRows(workItemId);
  return artifactRows
    .map((artifact) => ({
      artifactId: artifact.id,
      filePath: artifact.filePath,
      changed: sourceRows
        .filter((row) => row.artifactId === artifact.id)
        .map(describeChange)
        .filter((change): change is ChangedSource => change !== null),
    }))
    .filter((drift) => drift.changed.length > 0);
}

/** Every file some artifact of the work item was written from. */
export function listWorkItemSourcePaths(workItemId: string): string[] {
  return [...new Set(listWorkItemSourceRows(workItemId).sourceRows.map((row) => row.path))];
}
