import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  branchOf,
  createSoloRepo,
  gitDirOf,
  hashWorkingFiles,
  headOf,
  prepareLaneWork,
  readBytes,
  removeSoloRepo,
  soloBackupDir,
  soloRecordFile,
  soloRefsOf,
  statusOf,
  trackConfigLocalInLane,
  type SoloRepo,
} from './_testing/solo-repo-fixture';
import { acquireSoloHost } from './acquire-solo-host';
import { readSoloState } from './solo-state';

/**
 * An acquire that fails after the root's files were already rewritten to the
 * lane's (Risks: "Solo touches the user's root"). The trigger is real: a
 * `HEAD.lock` another git process holds in the root — a commit or checkout
 * the user's editor is running, or one that crashed. It blocks only moving
 * the root's HEAD, which comes after every file is written, so the root holds
 * the lane's files (an ignored root file overwritten from the backup set
 * included) when the acquire fails. The rollback must work with the lock
 * still held and put the root back byte for byte.
 */
describe('acquireSoloHost failing after the root files moved', () => {
  let repo: SoloRepo;

  beforeEach(() => {
    repo = createSoloRepo();
    trackConfigLocalInLane(repo.lane);
    prepareLaneWork(repo.lane);
  });

  afterEach(() => {
    fs.rmSync(path.join(gitDirOf(repo.root), 'HEAD.lock'), { force: true });
    removeSoloRepo(repo);
  });

  it('puts the root back byte for byte, on its branch, with no record, ref or backup left', async () => {
    const before = hashWorkingFiles(repo.root);
    const head = headOf(repo.root);
    const srcMtime = fs.statSync(path.join(repo.root, 'src')).mtimeMs;
    const lockFile = path.join(gitDirOf(repo.root), 'HEAD.lock');
    fs.writeFileSync(lockFile, '');

    await expect(
      acquireSoloHost({ rootPath: repo.root, laneId: 'lane-a', laneCheckoutPath: repo.lane })
    ).rejects.toThrow(/HEAD\.lock/);

    // The files had moved: the lane's src/feature.ts was written, and taken away again.
    expect(fs.statSync(path.join(repo.root, 'src')).mtimeMs).not.toBe(srcMtime);
    expect(fs.existsSync(path.join(repo.root, 'src', 'feature.ts'))).toBe(false);
    // The rollback ran with the lock held; the other process still owns it.
    expect(fs.existsSync(lockFile)).toBe(true);
    expect(hashWorkingFiles(repo.root)).toEqual(before);
    expect(readBytes(repo.root, 'config.local').toString()).toBe('ROOT_SECRET=1\n');
    expect(fs.existsSync(soloRecordFile(repo.root))).toBe(false);
    expect(fs.existsSync(soloBackupDir(repo.root))).toBe(false);
    expect(soloRefsOf(repo.root)).toEqual([]);

    fs.rmSync(lockFile);
    expect(headOf(repo.root)).toBe(head);
    expect(branchOf(repo.root)).toBe('main');
    expect(statusOf(repo.root)).toBe('');
    expect((await readSoloState(repo.root)).status).toBe('none');
  });
});
