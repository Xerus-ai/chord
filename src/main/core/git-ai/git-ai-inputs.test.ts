import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { GitAiError } from './git-ai-errors';
import { readCommitInput, readPullRequestInput } from './git-ai-inputs';

function git(cwd: string, ...args: string[]): string {
  return execFileSync(GIT_EXECUTABLE, args, { cwd, encoding: 'utf8' });
}

function commitFile(repo: string, file: string, text: string, message: string): void {
  fs.writeFileSync(path.join(repo, file), text);
  git(repo, 'add', file);
  git(repo, 'commit', '-q', '-m', message);
}

/** What a read must leave behind: the same index and working tree as before. */
function snapshot(repo: string): string {
  return `${git(repo, 'status', '--porcelain=v1', '--untracked-files=all')}\n${git(repo, 'diff', '--cached')}`;
}

let root: string;
let repo: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'chord-git-ai-inputs-'));
  repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'test@chord.invalid');
  git(repo, 'config', 'user.name', 'Chord test');
  commitFile(repo, 'README.md', '# repo\n', 'readme');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/**
 * Generate in the commit field describes what Commit will commit: the staged
 * changes, or — when nothing is staged, since Chord's Commit then stages
 * everything — every change in the checkout, new files included. Reading it
 * never touches the index or the files.
 */
describe('readCommitInput', () => {
  it('is the staged diff when something is staged, without the unstaged change', async () => {
    fs.writeFileSync(path.join(repo, 'staged.ts'), 'export const staged = 1;\n');
    git(repo, 'add', 'staged.ts');
    fs.writeFileSync(path.join(repo, 'README.md'), '# repo\nunstaged edit\n');

    const input = await readCommitInput(repo);
    expect(input.source).toBe('staged');
    expect(input.branch).toBe('main');
    expect(input.diff).toContain('+export const staged = 1;');
    expect(input.diff).not.toContain('unstaged edit');
  });

  it('with nothing staged, is every change — edits and new files', async () => {
    fs.writeFileSync(path.join(repo, 'README.md'), '# repo\nunstaged edit\n');
    fs.writeFileSync(path.join(repo, 'new-file.ts'), 'export const fresh = true;\n');

    const input = await readCommitInput(repo);
    expect(input.source).toBe('all');
    expect(input.diff).toContain('+unstaged edit');
    expect(input.diff).toContain('new-file.ts');
    expect(input.diff).toContain('+export const fresh = true;');
  });

  it('leaves the index and the working tree exactly as they were', async () => {
    fs.writeFileSync(path.join(repo, 'README.md'), '# repo\nunstaged edit\n');
    fs.writeFileSync(path.join(repo, 'new-file.ts'), 'export const fresh = true;\n');
    const before = snapshot(repo);

    await readCommitInput(repo);
    expect(snapshot(repo)).toBe(before);
  });

  it('refuses a clean checkout: there is nothing to describe', async () => {
    await expect(readCommitInput(repo)).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof GitAiError && error.failure.type === 'nothing_to_describe'
    );
  });
});

/**
 * Generate in Create PR describes the lane: its commits since it left its
 * target_ref, and the merge-base diff `target...HEAD`, so commits the target
 * gained meanwhile are not described as this lane's work.
 */
describe('readPullRequestInput', () => {
  beforeEach(() => {
    git(repo, 'checkout', '-q', '-b', 'raghav/login');
    commitFile(repo, 'login.ts', 'export function login() {}\n', 'Add login');
    commitFile(repo, 'login.test.ts', 'test("login", () => {});\n', 'Test login');
    git(repo, 'checkout', '-q', 'main');
    commitFile(repo, 'main-only.ts', 'export const later = 1;\n', 'Main moved on');
    git(repo, 'checkout', '-q', 'raghav/login');
  });

  it("lists the lane's commits, oldest first, and their diff against the target", async () => {
    const input = await readPullRequestInput(repo, 'main');
    expect(input.branch).toBe('raghav/login');
    expect(input.commits.indexOf('Add login')).toBeGreaterThanOrEqual(0);
    expect(input.commits.indexOf('Add login')).toBeLessThan(input.commits.indexOf('Test login'));
    expect(input.diff).toContain('+export function login() {}');
    expect(input.diff).toContain('login.test.ts');
  });

  it('does not count what the target gained after the lane forked', async () => {
    const input = await readPullRequestInput(repo, 'main');
    expect(input.commits).not.toContain('Main moved on');
    expect(input.diff).not.toContain('main-only.ts');
  });

  it('has no pending changes for a clean checkout', async () => {
    expect((await readPullRequestInput(repo, 'main')).pendingDiff).toBe('');
  });

  /**
   * Create PR commits a dirty checkout first (create-lane-pull-request.ts
   * publishLaneBranch), so those changes are part of the PR it opens: they
   * are read as their own "will be committed with this PR" diff.
   */
  it('reads uncommitted changes — staged, unstaged and new files — apart from the commits', async () => {
    fs.writeFileSync(path.join(repo, 'login.ts'), 'export function login() {\n  redirect();\n}\n');
    fs.writeFileSync(path.join(repo, 'staged.ts'), 'export const staged = 1;\n');
    git(repo, 'add', 'staged.ts');
    fs.writeFileSync(path.join(repo, 'brand-new.ts'), 'export const fresh = true;\n');

    const input = await readPullRequestInput(repo, 'main');
    expect(input.pendingDiff).toContain('+  redirect();');
    expect(input.pendingDiff).toContain('+export const staged = 1;');
    expect(input.pendingDiff).toContain('+export const fresh = true;');
    expect(input.diff).not.toContain('redirect();');
    expect(input.diff).not.toContain('brand-new.ts');
    expect(input.commits).toContain('Add login');
  });

  it('reading the pending changes leaves the index and the working tree as they were', async () => {
    fs.writeFileSync(path.join(repo, 'login.ts'), 'export function login() {\n  redirect();\n}\n');
    fs.writeFileSync(path.join(repo, 'brand-new.ts'), 'export const fresh = true;\n');
    const before = snapshot(repo);

    await readPullRequestInput(repo, 'main');
    expect(snapshot(repo)).toBe(before);
  });

  it('describes a lane with no commits yet whose changes Create PR will commit', async () => {
    git(repo, 'checkout', '-q', '-b', 'dirty-lane', 'main');
    fs.writeFileSync(path.join(repo, 'brand-new.ts'), 'export const fresh = true;\n');

    const input = await readPullRequestInput(repo, 'main');
    expect(input.commits).toBe('');
    expect(input.diff).toBe('');
    expect(input.pendingDiff).toContain('+export const fresh = true;');
  });

  it('refuses a lane with no commits of its own and nothing uncommitted', async () => {
    git(repo, 'checkout', '-q', '-b', 'empty-lane', 'main');
    await expect(readPullRequestInput(repo, 'main')).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof GitAiError && error.failure.type === 'nothing_to_describe'
    );
  });

  it('throws for a target git cannot resolve — it is not "no changes"', async () => {
    await expect(readPullRequestInput(repo, 'origin/does-not-exist')).rejects.toThrow();
    await expect(readPullRequestInput(repo, 'origin/does-not-exist')).rejects.not.toBeInstanceOf(
      GitAiError
    );
  });
});
