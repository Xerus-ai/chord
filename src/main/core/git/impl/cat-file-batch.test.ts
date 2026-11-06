import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CatFileBatch } from './cat-file-batch';

const repos: string[] = [];

// Each case's repository goes with it, pass or fail (devstation-i3y5.5). The
// batch is disposed inside the case, but dispose() only signals its
// `git cat-file` child: on Windows the exiting child holds the folder (EPERM)
// until it is gone, so the removal is retried until it lands.
afterEach(async () => {
  for (const dir of repos.splice(0)) {
    await vi.waitFor(() => rmSync(dir, { recursive: true, force: true }), { timeout: 10_000 });
  }
});

function makeTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'chord-catfile-'));
  repos.push(dir);
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "t@test.local"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "test"', { cwd: dir, stdio: 'pipe' });
  writeFileSync(join(dir, 'a.txt'), 'hello\n');
  execSync('git add a.txt && git commit -m init', { cwd: dir, stdio: 'pipe' });
  return dir;
}

describe('CatFileBatch', () => {
  it('reads blob contents via git cat-file --batch', async () => {
    const dir = makeTempRepo();
    const batch = new CatFileBatch(dir);
    try {
      const content = await batch.read('HEAD:a.txt');
      expect(content).toBe('hello\n');
    } finally {
      batch.dispose();
    }
  });

  it('resolves null for a missing path', async () => {
    const dir = makeTempRepo();
    const batch = new CatFileBatch(dir);
    try {
      expect(await batch.read('HEAD:does-not-exist.txt')).toBeNull();
    } finally {
      batch.dispose();
    }
  });

  it('rejects new reads after dispose', async () => {
    const dir = makeTempRepo();
    const batch = new CatFileBatch(dir);
    batch.dispose();
    await expect(batch.read('HEAD:a.txt')).rejects.toThrow();
  });
});
