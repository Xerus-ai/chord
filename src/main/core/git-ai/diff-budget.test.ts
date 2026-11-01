import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { budgetDiff } from './diff-budget';

function git(cwd: string, ...args: string[]): string {
  return execFileSync(GIT_EXECUTABLE, args, { cwd, encoding: 'utf8' });
}

const lines = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => `${prefix} line ${i + 1}`).join('\n') + '\n';

/**
 * A staged diff from a real repository: one big file, one medium, one tiny,
 * a deletion and a binary file — what `git diff --cached` prints for them.
 */
let root: string;
let stagedDiff: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'chord-git-ai-budget-'));
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'test@chord.invalid');
  git(root, 'config', 'user.name', 'Chord test');
  fs.writeFileSync(path.join(root, 'gone.txt'), lines('gone', 5));
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'base');

  fs.writeFileSync(path.join(root, 'big.ts'), lines('big', 400));
  fs.writeFileSync(path.join(root, 'medium.ts'), lines('medium', 60));
  fs.writeFileSync(path.join(root, 'tiny.ts'), lines('tiny', 2));
  fs.writeFileSync(path.join(root, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));
  fs.rmSync(path.join(root, 'gone.txt'));
  git(root, 'add', '-A');
  stagedDiff = git(root, 'diff', '--cached', '--no-renames');
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/**
 * Plan §Phase 3 slice 4: "A diff over the prompt budget is sent as per-file
 * stats plus the largest hunks, and the prompt says it was cut."
 */
describe('budgetDiff', () => {
  it('sends a diff within the budget whole, and says nothing was cut', () => {
    const budgeted = budgetDiff(stagedDiff, stagedDiff.length + 1);
    expect(budgeted.cut).toBe(false);
    expect(budgeted.text).toBe(stagedDiff);
  });

  it('lists every file with its line counts, including deletions and binaries', () => {
    const budgeted = budgetDiff(stagedDiff, stagedDiff.length + 1);
    expect(budgeted.files).toEqual(
      expect.arrayContaining([
        { path: 'big.ts', additions: 400, deletions: 0, binary: false },
        { path: 'medium.ts', additions: 60, deletions: 0, binary: false },
        { path: 'tiny.ts', additions: 2, deletions: 0, binary: false },
        { path: 'gone.txt', additions: 0, deletions: 5, binary: false },
        { path: 'logo.png', additions: 0, deletions: 0, binary: true },
      ])
    );
    expect(budgeted.files).toHaveLength(5);
  });

  it('over the budget: stays within it, keeps every file in the stats, and says it was cut', () => {
    const budget = 6_000;
    const budgeted = budgetDiff(stagedDiff, budget);
    expect(stagedDiff.length).toBeGreaterThan(budget);
    expect(budgeted.cut).toBe(true);
    expect(budgeted.text.length).toBeLessThanOrEqual(budget);
    for (const file of ['big.ts', 'medium.ts', 'tiny.ts', 'gone.txt', 'logo.png']) {
      expect(budgeted.text).toContain(file);
    }
    expect(budgeted.text).toMatch(/medium\.ts\s+\+60\s+-0/);
  });

  it('over the budget: keeps the largest hunks that fit and drops the rest', () => {
    // Room for the medium file's hunk, not the 400-line one.
    const budgeted = budgetDiff(stagedDiff, 6_000);
    expect(budgeted.text).toContain('+medium line 60');
    expect(budgeted.text).not.toContain('+big line 400');
    expect(budgeted.omittedHunks).toBeGreaterThan(0);
  });

  it('with a budget too small for any hunk, still sends the stats and says it was cut', () => {
    const budgeted = budgetDiff(stagedDiff, 200);
    expect(budgeted.cut).toBe(true);
    expect(budgeted.text.length).toBeLessThanOrEqual(200);
    expect(budgeted.text).toContain('big.ts');
    expect(budgeted.text).not.toContain('@@');
  });

  it('an empty diff is empty, not cut', () => {
    expect(budgetDiff('', 1_000)).toEqual({ text: '', cut: false, files: [], omittedHunks: 0 });
  });
});
