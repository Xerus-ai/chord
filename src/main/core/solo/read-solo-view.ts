import { eq } from 'drizzle-orm';
import type { SoloView } from '@shared/solo';
import { db } from '@main/db/client';
import { repos } from '@main/db/schema-work-items';
import { buildSoloView, findSlot } from './solo-slots';

/** What the Run tab and the sidebar read for a repository (`solo.getState`). */
export async function readSoloView(repoId: string): Promise<SoloView> {
  const [repo] = db.select({ path: repos.path }).from(repos).where(eq(repos.id, repoId)).all();
  if (!repo) throw new Error(`Repository ${repoId} does not exist`);
  const slot = findSlot(repoId);
  // A hold keeps the root it began on; otherwise the repository's own path.
  const holding = slot && (slot.holder !== null || slot.interrupted !== null);
  return buildSoloView(repoId, holding ? slot.rootPath : repo.path);
}
