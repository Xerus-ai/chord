import { access } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Whether a checkout still exists at `repoPath`. A normal checkout has `.git`
 * as a directory; a linked worktree has it as a file — either is enough to
 * call the path "on disk". Split out of `work-item-crud.ts` so it can be
 * reused by `worktrees/workspace-bridge.ts` (boot acquisition must not try to
 * open a workspace over a missing or non-repo path) without that module
 * importing `work-item-crud.ts` — `work-item-crud.ts` calls into the bridge,
 * so the reverse import would be a cycle.
 */
export async function repoIsOnDisk(repoPath: string): Promise<boolean> {
  try {
    await access(join(repoPath, '.git'));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
