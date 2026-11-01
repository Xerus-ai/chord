import { enqueueRepoIndexOp } from '@main/core/work-items/git-index-queue';
import { log } from '@main/lib/logger';
import { restoreRecordedRoot } from './release-solo-host';
import { listRootChanges, resolveGitDir } from './solo-git';
import { readSoloRecord } from './solo-record';
import type { SoloBootRecovery, SoloState } from './solo-types';

export async function readSoloState(rootPath: string): Promise<SoloState> {
  const record = await readSoloRecord(await resolveGitDir(rootPath));
  return record ? { status: 'held', record } : { status: 'none' };
}

/**
 * The files changed in a held root since Solo last applied the lane (what
 * release would refuse with `root_changed`); empty when nothing is held.
 * Queued with the root's other index work, and changes nothing.
 */
export async function readSoloRootChanges(rootPath: string): Promise<string[]> {
  return enqueueRepoIndexOp(rootPath, async () => {
    const record = await readSoloRecord(await resolveGitDir(rootPath));
    if (!record) return [];
    return (await listRootChanges(rootPath, record)).files;
  });
}

/**
 * Settles a hold left over from a previous run of the app (the queue and the
 * run scripts do not survive a restart). A root still exactly as Solo left it
 * is released; a root changed since is left held and its changed files are
 * reported, for the user to restore (release with discard) or keep working.
 */
export async function recoverSoloOnBoot(rootPath: string): Promise<SoloBootRecovery> {
  return enqueueRepoIndexOp(rootPath, async () => {
    const gitDir = await resolveGitDir(rootPath);
    const record = await readSoloRecord(gitDir);
    if (!record) return 'none';
    const rootState = await listRootChanges(rootPath, record);
    if (rootState.files.length > 0) return { interrupted: { files: rootState.files } };
    const leftovers = await restoreRecordedRoot(rootPath, gitDir, record, rootState);
    if (leftovers) {
      log.info('[solo] moved run output out of the root on boot', { rootPath, ...leftovers });
    }
    return 'released';
  });
}
