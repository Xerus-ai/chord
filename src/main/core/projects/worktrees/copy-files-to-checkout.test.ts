import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { copyFilesToCheckout } from './copy-files-to-checkout';

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await new LocalExecutionContext({ root: cwd }).exec(GIT_EXECUTABLE, args);
  return stdout.trim();
}

describe('copyFilesToCheckout', () => {
  let root: string;
  let repoDir: string;
  let checkoutDir: string;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-files-'));
    repoDir = path.join(root, 'repo');
    checkoutDir = path.join(root, 'checkout');
    fs.mkdirSync(repoDir);
    await git(['init'], repoDir);
    await git(['config', 'user.email', 'test@test.com'], repoDir);
    await git(['config', 'user.name', 'Test'], repoDir);
    fs.writeFileSync(path.join(repoDir, '.gitignore'), '.env\n.env.local\n');
    fs.writeFileSync(path.join(repoDir, '.env.example'), 'TRACKED=1');
    await git(['add', '.'], repoDir);
    await git(['commit', '-m', 'init'], repoDir);
    await git(['worktree', 'add', '-b', 'lane', checkoutDir], repoDir);
    fs.writeFileSync(path.join(repoDir, '.env'), 'SECRET=abc');
    fs.writeFileSync(path.join(repoDir, '.env.local'), 'LOCAL=1');
  });

  afterEach(() => {
    removeDirSync(root);
  });

  it('copies gitignored matches into the checkout', async () => {
    const result = await copyFilesToCheckout({
      repoPath: repoDir,
      checkoutPath: checkoutDir,
      patterns: ['.env*'],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.copied.sort()).toEqual(['.env', '.env.local']);
    expect(fs.readFileSync(path.join(checkoutDir, '.env'), 'utf8')).toBe('SECRET=abc');
  });

  it('never overwrites a tracked file, even when the pattern matches it', async () => {
    fs.writeFileSync(path.join(repoDir, '.env.example'), 'LOCAL EDIT IN ROOT');

    const result = await copyFilesToCheckout({
      repoPath: repoDir,
      checkoutPath: checkoutDir,
      patterns: ['.env*'],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.copied).not.toContain('.env.example');
    expect(fs.readFileSync(path.join(checkoutDir, '.env.example'), 'utf8')).toBe('TRACKED=1');
  });

  it('never copies from outside the repository', async () => {
    fs.writeFileSync(path.join(root, 'outside.txt'), 'private');

    const result = await copyFilesToCheckout({
      repoPath: repoDir,
      checkoutPath: checkoutDir,
      patterns: ['../outside.txt'],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.copied).toEqual([]);
    expect(fs.existsSync(path.join(root, 'outside.txt'))).toBe(true);
    expect(fs.existsSync(path.join(checkoutDir, '..', 'outside.txt'))).toBe(true);
    expect(fs.readdirSync(checkoutDir)).not.toContain('outside.txt');
  });

  it('refuses the whole copy when the matches exceed the file limit', async () => {
    const result = await copyFilesToCheckout({
      repoPath: repoDir,
      checkoutPath: checkoutDir,
      patterns: ['.env*'],
      limits: { maxFiles: 1, maxBytes: 1024 },
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.type).toBe('limit_exceeded');
    expect(fs.existsSync(path.join(checkoutDir, '.env'))).toBe(false);
  });

  it('refuses the whole copy when the matches exceed the size limit', async () => {
    const result = await copyFilesToCheckout({
      repoPath: repoDir,
      checkoutPath: checkoutDir,
      patterns: ['.env*'],
      limits: { maxFiles: 100, maxBytes: 5 },
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.type).toBe('limit_exceeded');
  });
});
