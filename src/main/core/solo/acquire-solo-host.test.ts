import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addLane,
  blobOf,
  branchOf,
  createSoloRepo,
  expectRootMatchesLane,
  git,
  gitDirOf,
  hashWorkingFiles,
  headOf,
  indexEntriesOf,
  prepareLaneWork,
  readBytes,
  removeSoloRepo,
  soloBackupDir,
  soloRecordFile,
  soloRefsOf,
  stagedFilesOf,
  statusOf,
  trackConfigLocalInLane,
  writeFile,
  type SoloRepo,
} from './_testing/solo-repo-fixture';
import { acquireSoloHost } from './acquire-solo-host';
import { readSoloState } from './solo-state';

describe('acquireSoloHost', () => {
  let repo: SoloRepo;

  beforeEach(() => {
    repo = createSoloRepo();
  });

  afterEach(() => {
    removeSoloRepo(repo);
  });

  const acquireLane = (laneId = 'lane-a', laneCheckoutPath = repo.lane) =>
    acquireSoloHost({ rootPath: repo.root, laneId, laneCheckoutPath });

  /** The root is exactly as it was: files, HEAD, branch, and no Solo leftovers. */
  function expectRootUntouched(before: Record<string, string>, head: string): void {
    expect(hashWorkingFiles(repo.root)).toEqual(before);
    expect(headOf(repo.root)).toBe(head);
    expect(branchOf(repo.root)).toBe('main');
    expect(fs.existsSync(soloRecordFile(repo.root))).toBe(false);
    expect(fs.existsSync(soloBackupDir(repo.root))).toBe(false);
    expect(soloRefsOf(repo.root)).toEqual([]);
  }

  describe('refusals', () => {
    it('refuses a root with a modified tracked file and lists it, leaving the root alone', async () => {
      prepareLaneWork(repo.lane);
      writeFile(repo.root, 'src/app.ts', 'export const a = 99;\n');
      const before = hashWorkingFiles(repo.root);
      const head = headOf(repo.root);

      const result = await acquireLane();

      expect(result).toEqual({
        success: false,
        error: { type: 'root_dirty', files: ['src/app.ts'] },
      });
      expectRootUntouched(before, head);
    });

    it('refuses a root with a staged change and lists it', async () => {
      writeFile(repo.root, 'README.md', '# staged\n');
      git(repo.root, 'add', 'README.md');

      const result = await acquireLane();

      expect(result).toEqual({
        success: false,
        error: { type: 'root_dirty', files: ['README.md'] },
      });
    });

    it('refuses a root with an untracked file and lists the file itself, not its folder', async () => {
      writeFile(repo.root, 'scratch/new.md', 'draft\n');

      const result = await acquireLane();

      expect(result).toEqual({
        success: false,
        error: { type: 'root_dirty', files: ['scratch/new.md'] },
      });
    });

    it('lists every dirty path, sorted, and does not count ignored files', async () => {
      writeFile(repo.root, 'src/app.ts', 'export const a = 99;\n');
      writeFile(repo.root, 'README.md', '# staged\n');
      git(repo.root, 'add', 'README.md');
      writeFile(repo.root, 'scratch/new.md', 'draft\n');
      writeFile(repo.root, 'dist/extra.js', 'ignored();\n');

      const result = await acquireLane();

      expect(result).toEqual({
        success: false,
        error: { type: 'root_dirty', files: ['README.md', 'scratch/new.md', 'src/app.ts'] },
      });
    });

    it('refuses a root with a merge in progress', async () => {
      git(repo.root, 'checkout', '-q', '-b', 'other');
      writeFile(repo.root, 'other.txt', 'other\n');
      git(repo.root, 'add', '-A');
      git(repo.root, 'commit', '-q', '-m', 'other');
      git(repo.root, 'checkout', '-q', 'main');
      git(repo.root, 'merge', '--no-commit', '--no-ff', 'other');

      const result = await acquireLane();

      expect(result).toEqual({
        success: false,
        error: { type: 'root_busy', operation: 'merge' },
      });
    });

    it('refuses while another lane holds the slot, naming the holder', async () => {
      const laneB = addLane(repo, 'lane-b', 'feature-b');
      expect((await acquireLane('lane-a')).success).toBe(true);

      const result = await acquireLane('lane-b', laneB);

      expect(result).toEqual({
        success: false,
        error: { type: 'solo_held', laneId: 'lane-a' },
      });
    });

    it('lets exactly one of two concurrent acquires on the same root through', async () => {
      prepareLaneWork(repo.lane);
      const laneB = addLane(repo, 'lane-b', 'feature-b');

      const results = await Promise.all([acquireLane('lane-a'), acquireLane('lane-b', laneB)]);

      const winners = results.filter((result) => result.success);
      const losers = results.filter((result) => !result.success);
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      const state = await readSoloState(repo.root);
      expect(state.status).toBe('held');
      if (state.status !== 'held') return;
      expect(losers[0]).toEqual({
        success: false,
        error: { type: 'solo_held', laneId: state.record.laneId },
      });
      expect(headOf(repo.root)).toBe(state.record.laneHead);
    });
  });

  describe('applying the lane', () => {
    it("puts the lane's HEAD (detached) and its uncommitted and untracked files in the root, with nothing staged", async () => {
      prepareLaneWork(repo.lane);

      const result = await acquireLane();

      expect(result.success).toBe(true);
      expect(headOf(repo.root)).toBe(headOf(repo.lane));
      expect(branchOf(repo.root)).toBe('HEAD');
      expect(stagedFilesOf(repo.root)).toBe('');
      // The root shows the lane's uncommitted work as uncommitted.
      expect(statusOf(repo.root)).toBe(statusOf(repo.lane));
      expectRootMatchesLane(repo.root, repo.lane);
      expect(fs.existsSync(path.join(repo.root, 'src/util.ts'))).toBe(false);
      expect(fs.existsSync(path.join(repo.root, 'docs/guide.md'))).toBe(false);
      // Ignored root files the lane does not touch stay as they were.
      expect(readBytes(repo.root, 'dist/bundle.js').toString()).toBe('bundle();\n');
      expect(readBytes(repo.root, 'config.local').toString()).toBe('ROOT_SECRET=1\n');
    });

    it("never touches the lane checkout's files or index", async () => {
      prepareLaneWork(repo.lane);
      const filesBefore = hashWorkingFiles(repo.lane);
      const indexBefore = indexEntriesOf(repo.lane);
      const statusBefore = statusOf(repo.lane);
      const headBefore = headOf(repo.lane);

      expect((await acquireLane()).success).toBe(true);

      expect(hashWorkingFiles(repo.lane)).toEqual(filesBefore);
      expect(indexEntriesOf(repo.lane)).toBe(indexBefore);
      expect(statusOf(repo.lane)).toBe(statusBefore);
      expect(headOf(repo.lane)).toBe(headBefore);
      expect(branchOf(repo.lane)).toBe('feature');
    });

    it('records the hold in the git dir, anchored by a ref on the snapshot commit', async () => {
      prepareLaneWork(repo.lane);
      const rootHead = headOf(repo.root);

      const result = await acquireLane();

      expect(result.success).toBe(true);
      const state = await readSoloState(repo.root);
      expect(state.status).toBe('held');
      if (state.status !== 'held') return;
      const { record } = state;
      expect(record).toMatchObject({
        version: 1,
        laneId: 'lane-a',
        laneCheckoutPath: repo.lane,
        rootHead,
        rootBranch: 'main',
        laneHead: headOf(repo.lane),
      });
      expect(Number.isNaN(Date.parse(record.startedAt))).toBe(false);
      expect(git(repo.root, 'rev-parse', 'refs/chord/solo/lane-a').trim()).toBe(
        record.snapshotCommit
      );
      expect(git(repo.root, 'rev-parse', `${record.snapshotCommit}^`).trim()).toBe(record.laneHead);
      expect(JSON.parse(fs.readFileSync(soloRecordFile(repo.root), 'utf8'))).toEqual(record);
      if (result.success) expect(result.data).toEqual(record);
    });

    it('records a detached root as rootBranch null', async () => {
      git(repo.root, 'checkout', '-q', '--detach');

      const result = await acquireLane();

      expect(result.success).toBe(true);
      const state = await readSoloState(repo.root);
      if (state.status !== 'held') throw new Error('expected a held slot');
      expect(state.record.rootBranch).toBeNull();
    });

    it('backs up an ignored root file the snapshot tracks before overwriting it', async () => {
      trackConfigLocalInLane(repo.lane);

      const result = await acquireLane();

      expect(result.success).toBe(true);
      expect(blobOf(repo.root, 'config.local')).toBe(blobOf(repo.lane, 'config.local'));
      expect(readBytes(soloBackupDir(repo.root), 'config.local').toString()).toBe(
        'ROOT_SECRET=1\n'
      );
      const state = await readSoloState(repo.root);
      if (state.status !== 'held') throw new Error('expected a held slot');
      expect(state.record.backups).toContain('config.local');
    });
  });

  describe('failing midway', () => {
    it('leaves the root as it was when the lane path is not a checkout', async () => {
      const notACheckout = path.join(repo.dir, 'not-a-checkout');
      fs.mkdirSync(notACheckout);
      const before = hashWorkingFiles(repo.root);
      const head = headOf(repo.root);

      await expect(acquireLane('lane-a', notACheckout)).rejects.toThrow();

      expectRootUntouched(before, head);
      expect(statusOf(repo.root)).toBe('');
    });

    it("removes the snapshot ref and backups when the root's index is locked by another git process", async () => {
      trackConfigLocalInLane(repo.lane);
      prepareLaneWork(repo.lane);
      const before = hashWorkingFiles(repo.root);
      const head = headOf(repo.root);
      const lockFile = path.join(gitDirOf(repo.root), 'index.lock');
      fs.writeFileSync(lockFile, '');

      await expect(acquireLane()).rejects.toThrow(/index\.lock/);

      fs.rmSync(lockFile);
      expectRootUntouched(before, head);
      expect(statusOf(repo.root)).toBe('');
      expect((await readSoloState(repo.root)).status).toBe('none');
    });
  });
});
