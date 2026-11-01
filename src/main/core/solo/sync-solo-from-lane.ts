import { err, ok, type Result } from '@shared/result';
import { enqueueRepoIndexOp } from '@main/core/work-items/git-index-queue';
import { backupRootFiles } from './solo-backup';
import {
  diffTreePaths,
  listRootChanges,
  loadRootIndex,
  refreshRootIndex,
  resolveGitDir,
  rewriteRootPaths,
  runGit,
  setRootHead,
  snapshotLane,
} from './solo-git';
import { readSoloRecord, soloBackupDir, soloRefName, writeSoloRecord } from './solo-record';
import type { SoloRecord, SyncSoloError } from './solo-types';

/**
 * Re-snapshots the lane holding the root and applies its current state over
 * the root in place — nothing is stopped, so dev servers just reload. Only
 * paths that differ between the last applied snapshot and the new one are
 * rewritten. Refuses `root_changed` with the files when the root was edited
 * during Solo, since applying over it would lose those edits.
 *
 * A path the lane touches for the first time (it matched the root's original
 * HEAD in the last snapshot) still holds the root's original bytes, so they
 * are backed up before it is rewritten. The record is updated last; a failure
 * midway leaves the record on the previous snapshot, and the root then reads
 * as changed, which release reports (and discarding restores).
 */
export async function syncSoloFromLane(args: {
  rootPath: string;
}): Promise<Result<SoloRecord, SyncSoloError>> {
  const { rootPath } = args;
  return enqueueRepoIndexOp(rootPath, async () => {
    const gitDir = await resolveGitDir(rootPath);
    const record = await readSoloRecord(gitDir);
    if (!record) return err({ type: 'solo_not_held' as const });
    const rootState = await listRootChanges(rootPath, record);
    if (rootState.files.length > 0) {
      return err({ type: 'root_changed' as const, files: rootState.files });
    }

    const { laneHead, snapshotCommit } = await snapshotLane(record.laneCheckoutPath, record.laneId);
    const touched = await diffTreePaths(rootPath, record.snapshotCommit, snapshotCommit);
    const appliedBefore = new Set(
      await diffTreePaths(rootPath, record.rootHead, record.snapshotCommit)
    );
    const firstTouched = touched.filter((file) => !appliedBefore.has(file));
    const newBackups = await backupRootFiles(
      rootPath,
      soloBackupDir(gitDir),
      firstTouched,
      new Set(record.backups)
    );
    const withBackups: SoloRecord = {
      ...record,
      backups: [...record.backups, ...newBackups].sort(),
    };
    await writeSoloRecord(gitDir, withBackups);

    await loadRootIndex(rootPath, laneHead);
    await rewriteRootPaths(rootPath, snapshotCommit, touched);
    await setRootHead(rootPath, { branch: null, commit: laneHead });
    await refreshRootIndex(rootPath);
    await runGit(rootPath, ['update-ref', soloRefName(record.laneId), snapshotCommit]);

    const synced: SoloRecord = { ...withBackups, laneHead, snapshotCommit };
    await writeSoloRecord(gitDir, synced);
    return ok(synced);
  });
}
