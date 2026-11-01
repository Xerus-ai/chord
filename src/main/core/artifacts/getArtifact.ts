import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { artifacts } from '@main/db/schema-artifacts';
import { resolveStoredArtifactPath } from './artifact-file-path';

export async function getArtifact(id: string) {
  const [row] = await db.select().from(artifacts).where(eq(artifacts.id, id)).limit(1);
  if (!row) return null;
  return { ...row, filePath: resolveStoredArtifactPath(row.filePath, row.workItemId) };
}
