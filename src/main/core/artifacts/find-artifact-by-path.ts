import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { artifacts, type ArtifactRow } from '@main/db/schema-artifacts';
import { resolveAgentReportedPath } from '@main/utils/agent-reported-path';
import { findWorkItemRepoPath } from './artifact-file-path';

/**
 * The work item's artifacts with every stored path translated to the real one
 * (see `artifact-file-path.ts`), read synchronously so a caller can decide and
 * write in the same tick — the publish upsert and turn completion both do.
 */
export function listWorkItemArtifactRows(workItemId: string): ArtifactRow[] {
  const rows = db.select().from(artifacts).where(eq(artifacts.workItemId, workItemId)).all();
  const repoPath = findWorkItemRepoPath(workItemId);
  return rows.map((row) => ({
    ...row,
    filePath: resolveAgentReportedPath(row.filePath, repoPath),
  }));
}

/** The artifact a file already is in this work item, if any. Identity is `(work_item_id, file_path)`. */
export function findArtifactByPath(workItemId: string, filePath: string): ArtifactRow | null {
  return listWorkItemArtifactRows(workItemId).find((row) => row.filePath === filePath) ?? null;
}
