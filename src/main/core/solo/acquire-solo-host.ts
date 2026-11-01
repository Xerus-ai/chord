import { rm } from 'node:fs/promises';
import path from 'node:path';
import { err, ok, type Result } from '@shared/result';
import { enqueueRepoIndexOp } from '@main/core/work-items/git-index-queue';
import { backupRootFiles, restoreRootFiles } from './solo-backup';
import {
  detectRootOperation,
  diffTreePaths,
  listDirtyPaths,
  loadRootIndex,
  refreshRootIndex,
  refreshRootIndexStat,
  resolveBranch,
  resolveCommonGitDir,
  resolveGitDir,
  resolveHead,
  rewriteRootPaths,
  runGit,
  setRootHead,
  snapshotLane,
} from './solo-git';
import {
  deleteSoloRecord,
  readSoloRecord,
  soloBackupDir,
  soloRefName,
  writeSoloRecord,
} from './solo-record';
import type { AcquireSoloError, SoloRecord } from './solo-types';

interface AcquireSoloArgs {
  rootPath: string;
  laneId: string;
  laneCheckoutPath: string;
}

function normalizePath(dir: string): string {
  const resolved = path.resolve(dir);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

async function assertLaneOfRoot(args: AcquireSoloArgs): Promise<void> {
  if (normalizePath(args.laneCheckoutPath) === normalizePath(args.rootPath)) {
    throw new Error(`Solo: the lane checkout is the root itself (${args.rootPath})`);
  }
  const [rootCommon, laneCommon] = await Promise.all([
    resolveCommonGitDir(args.rootPath),
    resolveCommonGitDir(args.laneCheckoutPath),
  ]);
  if (rootCommon !== laneCommon) {
    throw new Error(
      `Solo: ${args.laneCheckoutPath} is not a checkout of the repository at ${args.rootPath}`
    );
  }
  try {
    await runGit(args.rootPath, ['check-ref-format', soloRefName(args.laneId)]);
  } catch (error) {
    throw new Error(`Solo: lane id "${args.laneId}" cannot name a git ref`, { cause: error });
  }
}

/**
 * Puts a lane's state in the repo's root checkout so its run scripts run from
 * the root's stable directory. Refuses a root another lane holds, a root in
 * the middle of a merge/rebase/cherry-pick/revert/bisect, and a root with any
 * change (untracked files included). Then:
 *  - snapshots the lane (tracked changes + untracked, non-ignored files) into
 *    a commit on its HEAD through a temp index, anchored by
 *    `refs/chord/solo/<laneId>`; the lane's index and files are not touched;
 *  - backs up the original bytes of every root file the move overwrites or
 *    deletes (ignored files in the way included) to
 *    `<git dir>/chord-solo-backup/`;
 *  - detaches the root at the lane's HEAD, its index at that commit, and
 *    rewrites only the paths that differ so the working tree is the
 *    snapshot's: `git status` in the root shows the lane's uncommitted work
 *    as uncommitted. Plumbing only, so no checkout hooks run;
 *  - writes `<git dir>/chord-solo.json` last, once the root holds the lane.
 * Any failure puts the root back as it was, removes the ref and backups, and
 * rethrows: a root is never left half-applied.
 */
export async function acquireSoloHost(
  args: AcquireSoloArgs
): Promise<Result<SoloRecord, AcquireSoloError>> {
  const { rootPath, laneId, laneCheckoutPath } = args;
  return enqueueRepoIndexOp(rootPath, async () => {
    const gitDir = await resolveGitDir(rootPath);
    const held = await readSoloRecord(gitDir);
    if (held) return err({ type: 'solo_held' as const, laneId: held.laneId });
    const operation = detectRootOperation(gitDir);
    if (operation) return err({ type: 'root_busy' as const, operation });
    const dirty = await listDirtyPaths(rootPath);
    if (dirty.length > 0) return err({ type: 'root_dirty' as const, files: dirty });

    await assertLaneOfRoot(args);
    const rootHead = await resolveHead(rootPath);
    const rootBranch = await resolveBranch(rootPath);
    const { laneHead, snapshotCommit } = await snapshotLane(laneCheckoutPath, laneId);
    const touched = await diffTreePaths(rootPath, rootHead, snapshotCommit);
    const backupDir = soloBackupDir(gitDir);
    let backups: string[] = [];
    let rootTouched = false;
    let headMoved = false;

    try {
      await runGit(rootPath, ['update-ref', soloRefName(laneId), snapshotCommit]);
      backups = await backupRootFiles(rootPath, backupDir, touched, new Set());
      await loadRootIndex(rootPath, laneHead);
      rootTouched = true;
      await rewriteRootPaths(rootPath, snapshotCommit, touched);
      await setRootHead(rootPath, { branch: null, commit: laneHead });
      headMoved = true;
      await refreshRootIndex(rootPath);
      const record: SoloRecord = {
        version: 1,
        laneId,
        laneCheckoutPath,
        rootHead,
        rootBranch,
        laneHead,
        snapshotCommit,
        backups,
        startedAt: new Date().toISOString(),
      };
      await writeSoloRecord(gitDir, record);
      return ok(record);
    } catch (error) {
      try {
        if (rootTouched) {
          await loadRootIndex(rootPath, rootHead);
          await rewriteRootPaths(rootPath, rootHead, touched);
          await restoreRootFiles(rootPath, backupDir, backups);
          if (headMoved) {
            await setRootHead(rootPath, { branch: rootBranch, commit: rootHead });
            await refreshRootIndex(rootPath);
          } else {
            // HEAD never left the root's commit, and the move may have failed
            // on another process's HEAD.lock: refresh without touching refs.
            await refreshRootIndexStat(rootPath);
          }
        }
        await deleteSoloRecord(gitDir);
        await runGit(rootPath, ['update-ref', '-d', soloRefName(laneId)]);
        await rm(backupDir, { recursive: true, force: true });
      } catch (rollbackError) {
        throw new Error(
          `Solo acquire failed (${String(error)}) and putting the root back failed too: ` +
            `${String(rollbackError)}. The root's original files are in ${backupDir}.`,
          { cause: error }
        );
      }
      throw error;
    }
  });
}
