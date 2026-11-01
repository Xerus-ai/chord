import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { toRepoRelativePath } from './repo-relative-path';

/**
 * An artifact's path as the repo's file list spells it (forward slashes,
 * relative to the checkout), so its tab and the Files tab are one tab
 * (design 2026-09-26 §3). A file outside the repo has none.
 */
describe('toRepoRelativePath', () => {
  const repo = join('/work', 'repo');

  it('spells a file inside the repo the way the file list does', () => {
    expect(toRepoRelativePath(join(repo, 'docs', 'spec.md'), repo)).toBe('docs/spec.md');
    expect(toRepoRelativePath(join(repo, 'hero.html'), repo)).toBe('hero.html');
  });

  it('has no repo path for a file outside the repo (a plan in the profile)', () => {
    expect(toRepoRelativePath(join('/work', 'other', 'plan.md'), repo)).toBeNull();
    expect(toRepoRelativePath(join('/work', 'repo-sibling', 'x.md'), repo)).toBeNull();
  });

  it('has none without a file or without a repo', () => {
    expect(toRepoRelativePath(null, repo)).toBeNull();
    expect(toRepoRelativePath(join(repo, 'a.md'), null)).toBeNull();
  });

  it('is not the repo directory itself', () => {
    expect(toRepoRelativePath(repo, repo)).toBeNull();
  });
});
