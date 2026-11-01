import { rm } from 'node:fs/promises';
import { err, ok, type Result } from '@shared/result';
import type { SoloLeftovers } from '@shared/solo';
import { enqueueRepoIndexOp } from '@main/core/work-items/git-index-queue';
import { restoreRootFiles } from './solo-backup';
import {
  diffTreePaths,
  listDirtyPaths,
  listIgnoredEntries,
  listRootChanges,
  loadRootIndex,
  refreshRootIndex,
  resolveBranch,
  resolveGitDir,
  resolveHead,
  rewriteRootPaths,
  runGit,
  setRootHead,
} from './solo-git';
import { moveRunLeftovers } from './solo-leftovers';
import { deleteSoloRecord, readSoloRecord, soloBackupDir, soloRefName } from './solo-record';
import type { ReleaseSoloError, SoloRecord } from './solo-types';

/**
 * Returns a held root to the HEAD and branch it had before Solo, with the
 * original bytes of every file Solo overwrote or deleted, then verifies HEAD,
 * branch and a clean `git status` and removes the record, ref and backups.
 * `rootState` is the root's current state (`listRootChanges`): every path
 * where it differs from the recorded HEAD is rewritten, so changes made in the
 * root during Solo are discarded — callers refuse first unless discarding was
 * asked for. Ignored files the Solo run created (its caches and build output)
 * are left in place; ignored files it modified keep the run's version unless
 * the lane's snapshot overwrote them, in which case the backup wins. Run
 * output that only the lane's rules ignored would make the root dirty on its
 * own branch: it is moved out and returned (`moveRunLeftovers`).
 * Not queued: the caller holds the root's index queue.
 */
export async function restoreRecordedRoot(
  rootPath: string,
  gitDir: string,
  record: SoloRecord,
  rootState: { tree: string }
): Promise<SoloLeftovers | null> {
  if (record.rootBranch !== null) {
    const branchTip = (
      await runGit(rootPath, ['rev-parse', '--verify', `refs/heads/${record.rootBranch}^{commit}`])
    ).trim();
    if (branchTip !== record.rootHead) {
      throw new Error(
        `Solo release: branch ${record.rootBranch} moved from ${record.rootHead} to ` +
          `${branchTip} while the root was held; the root was left as it is`
      );
    }
  }

  const backupDir = soloBackupDir(gitDir);
  // Under the lane's rules, which the root's working tree still has.
  const ignoredWhileHeld = await listIgnoredEntries(rootPath);
  const changed = await diffTreePaths(rootPath, rootState.tree, record.rootHead);
  await loadRootIndex(rootPath, record.rootHead);
  await rewriteRootPaths(rootPath, record.rootHead, changed);
  await restoreRootFiles(rootPath, backupDir, record.backups);
  await setRootHead(rootPath, { branch: record.rootBranch, commit: record.rootHead });
  await refreshRootIndex(rootPath);
  const leftovers = await moveRunLeftovers(rootPath, gitDir, ignoredWhileHeld);

  const head = await resolveHead(rootPath);
  const branch = await resolveBranch(rootPath);
  const dirty = await listDirtyPaths(rootPath);
  if (head !== record.rootHead || branch !== record.rootBranch || dirty.length > 0) {
    throw new Error(
      `Solo release left the root at ${head} (${branch ?? 'detached'}) with changes in ` +
        `[${dirty.join(', ')}]; expected ${record.rootHead} (${record.rootBranch ?? 'detached'}) ` +
        `and a clean status. The record and the backups in ${backupDir} were kept.`
    );
  }

  await deleteSoloRecord(gitDir);
  await runGit(rootPath, ['update-ref', '-d', soloRefName(record.laneId)]);
  await rm(backupDir, { recursive: true, force: true });
  return leftovers;
}

/**
 * Ends the lane's hold on the root (see `restoreRecordedRoot`). Refuses
 * `root_changed` with the files when the root differs from the last snapshot
 * Solo applied, unless `discardRootChanges` is true — discarding is the
 * user's explicit second choice, never a silent default.
 */
export async function releaseSoloHost(args: {
  rootPath: string;
  discardRootChanges: boolean;
}): Promise<Result<{ leftovers: SoloLeftovers | null }, ReleaseSoloError>> {
  const { rootPath, discardRootChanges } = args;
  return enqueueRepoIndexOp(rootPath, async () => {
    const gitDir = await resolveGitDir(rootPath);
    const record = await readSoloRecord(gitDir);
    if (!record) return err({ type: 'solo_not_held' as const });
    const rootState = await listRootChanges(rootPath, record);
    if (rootState.files.length > 0 && !discardRootChanges) {
      return err({ type: 'root_changed' as const, files: rootState.files });
    }
    return ok({ leftovers: await restoreRecordedRoot(rootPath, gitDir, record, rootState) });
  });
}
