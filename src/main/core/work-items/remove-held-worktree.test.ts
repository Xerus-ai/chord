import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { removeLeftoverFolder, WorktreeLeftoverError } from './remove-held-worktree';

/**
 * Review P2 (lane AU round 1): after a held `git worktree remove`, the folder
 * git left is removed only when empty. Git stops at the first entry it cannot
 * delete, so a folder still holding files is kept and named, never swept.
 */
describe('removeLeftoverFolder', () => {
  let root: string;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'leftover-')));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('refuses a leftover that still holds files, keeps it, and names what is in it', async () => {
    const folder = path.join(root, 'lane');
    fs.mkdirSync(path.join(folder, 'src'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'src', 'work.ts'), 'unsaved work\n');
    fs.writeFileSync(path.join(folder, 'notes.md'), 'mine\n');

    const removal = removeLeftoverFolder(folder);

    await expect(removal).rejects.toBeInstanceOf(WorktreeLeftoverError);
    await expect(removal).rejects.toThrow(/notes\.md, src/);
    expect(fs.readFileSync(path.join(folder, 'src', 'work.ts'), 'utf8')).toBe('unsaved work\n');
  });

  it('removes an empty leftover, and is done when the folder is already gone', async () => {
    const folder = path.join(root, 'lane');
    fs.mkdirSync(folder);

    await removeLeftoverFolder(folder);
    expect(fs.existsSync(folder)).toBe(false);
    await expect(removeLeftoverFolder(folder)).resolves.toBeUndefined();
  });
});
