import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { artifacts } from '@main/db/schema-artifacts';
import { resolveAgentReportedPath } from '@main/utils/agent-reported-path';
import { findWorkItemRepoPath } from './artifact-file-path';
import { toRepoRelativePath } from './repo-relative-path';

export async function listArtifacts(workItemId: string) {
  const rows = await db.select().from(artifacts).where(eq(artifacts.workItemId, workItemId));
  // One repo lookup for the whole list — every row shares the work item.
  const repoPath = findWorkItemRepoPath(workItemId);
  return rows.map((row) => {
    const filePath = resolveAgentReportedPath(row.filePath, repoPath);
    return { ...row, filePath, repoRelativePath: toRepoRelativePath(filePath, repoPath) };
  });
}
