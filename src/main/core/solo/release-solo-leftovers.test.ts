import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  branchOf,
  createSoloRepo,
  git,
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
  writeFile,
  type SoloRepo,
} from './_testing/solo-repo-fixture';
import { acquireSoloHost } from './acquire-solo-host';
import { releaseSoloHost } from './release-solo-host';
import { recoverSoloOnBoot } from './solo-state';

/**
 * A lane whose `.gitignore` ignores more than the root's own branch does
 * (here `out/`): what its Solo run writes there is ignored while the root
 * holds the lane, and becomes untracked, non-ignored files once the root is
 * back on its branch. The root was clean before Solo, so such files can only
 * be the run's output. Release moves them — never deletes them, never leaves
 * them in the root — to `<git dir>/chord-solo-leftovers/<timestamp>/` with
 * their relative paths, and reports them.
 */
describe('run output a lane ignores and the root does not', () => {
  let repo: SoloRepo;

  beforeEach(() => {
    repo = createSoloRepo();
    writeFile(repo.lane, '.gitignore', 'dist/\n*.log\nconfig.local\nout/\n');
    git(repo.lane, 'add', '.gitignore');
    git(repo.lane, 'commit', '-q', '-m', 'ignore build output');
    prepareLaneWork(repo.lane);
  });

  afterEach(() => {
    removeSoloRepo(repo);
  });

  async function acquireLane(): Promise<void> {
    const result = await acquireSoloHost({
      rootPath: repo.root,
      laneId: 'lane-a',
      laneCheckoutPath: repo.lane,
    });
    if (!result.success) throw new Error(`acquire refused: ${JSON.stringify(result.error)}`);
  }

  /** What a dev server writes under the lane's ignored `out/`, plus a file under the root's own ignored `dist/`. */
  function writeRunOutput(): void {
    writeFile(repo.root, 'out/build.js', 'built during solo\n');
    writeFile(repo.root, 'out/maps/build.js.map', '{"version":3}\n');
    writeFile(repo.root, 'dist/run-output.js', 'also built during solo\n');
  }

  function leftoversRoot(): string {
    return path.join(gitDirOf(repo.root), 'chord-solo-leftovers');
  }

  it('moves them out of the root with their paths, reports them, and leaves the root clean and byte-identical', async () => {
    const before = hashWorkingFiles(repo.root);
    const head = headOf(repo.root);
    await acquireLane();
    writeRunOutput();

    const result = await releaseSoloHost({ rootPath: repo.root, discardRootChanges: false });

    expect(result).toEqual({
      success: true,
      data: {
        leftovers: {
          dir: expect.any(String),
          files: ['out/build.js', 'out/maps/build.js.map'],
        },
      },
    });
    if (!result.success || !result.data.leftovers) return;
    const { dir } = result.data.leftovers;
    expect(path.dirname(dir)).toBe(leftoversRoot());
    expect(readBytes(dir, 'out/build.js').toString()).toBe('built during solo\n');
    expect(readBytes(dir, 'out/maps/build.js.map').toString()).toBe('{"version":3}\n');

    expect(statusOf(repo.root)).toBe('');
    expect(fs.existsSync(path.join(repo.root, 'out'))).toBe(false);
    // Output under a path the root's own branch ignores stays where the run put it.
    expect(readBytes(repo.root, 'dist/run-output.js').toString()).toBe('also built during solo\n');
    const after = hashWorkingFiles(repo.root);
    delete after['dist/run-output.js'];
    expect(after).toEqual(before);
    expect(headOf(repo.root)).toBe(head);
    expect(branchOf(repo.root)).toBe('main');
    expect(fs.existsSync(soloRecordFile(repo.root))).toBe(false);
    expect(fs.existsSync(soloBackupDir(repo.root))).toBe(false);
    expect(soloRefsOf(repo.root)).toEqual([]);
  });

  it('reports no leftovers when the run wrote nothing the root would see', async () => {
    await acquireLane();

    const result = await releaseSoloHost({ rootPath: repo.root, discardRootChanges: false });

    expect(result).toEqual({ success: true, data: { leftovers: null } });
    expect(fs.existsSync(leftoversRoot())).toBe(false);
  });

  it('moves them on the Discard path too', async () => {
    const before = hashWorkingFiles(repo.root);
    await acquireLane();
    writeRunOutput();
    writeFile(repo.root, 'README.md', '# edited in the root\n');

    const result = await releaseSoloHost({ rootPath: repo.root, discardRootChanges: true });

    expect(result).toMatchObject({
      success: true,
      data: { leftovers: { files: ['out/build.js', 'out/maps/build.js.map'] } },
    });
    expect(statusOf(repo.root)).toBe('');
    const after = hashWorkingFiles(repo.root);
    delete after['dist/run-output.js'];
    expect(after).toEqual(before);
  });

  it('moves them when boot releases a leftover hold', async () => {
    const before = hashWorkingFiles(repo.root);
    await acquireLane();
    writeRunOutput();

    expect(await recoverSoloOnBoot(repo.root)).toBe('released');

    expect(statusOf(repo.root)).toBe('');
    const after = hashWorkingFiles(repo.root);
    delete after['dist/run-output.js'];
    expect(after).toEqual(before);
    const [stamp] = fs.readdirSync(leftoversRoot());
    expect(readBytes(path.join(leftoversRoot(), stamp), 'out/build.js').toString()).toBe(
      'built during solo\n'
    );
  });
});
