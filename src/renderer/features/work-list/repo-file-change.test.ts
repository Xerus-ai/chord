import { describe, expect, it } from 'vitest';
import type { FileWatchEvent } from '@shared/fs';
import { touchesRepoFile } from './repo-file-change';

/**
 * A repo file's Preview reloads when its file changes on disk (S9). The
 * worktree watcher reports every change under the worktree, relative and
 * POSIX-style; the preview reloads only for its own file.
 */
describe('touchesRepoFile', () => {
  const file = (type: FileWatchEvent['type'], path: string, oldPath?: string): FileWatchEvent => ({
    type,
    entryType: 'file',
    path,
    ...(oldPath !== undefined && { oldPath }),
  });

  it('matches a write, a create and a delete of the file', () => {
    expect(touchesRepoFile([file('modify', 'site/index.html')], 'site/index.html')).toBe(true);
    expect(touchesRepoFile([file('create', 'site/index.html')], 'site/index.html')).toBe(true);
    expect(touchesRepoFile([file('delete', 'site/index.html')], 'site/index.html')).toBe(true);
  });

  it('matches a rename onto the file, as an editor saving by rename does', () => {
    expect(
      touchesRepoFile(
        [file('rename', 'site/index.html', 'site/.index.html.tmp')],
        'site/index.html'
      )
    ).toBe(true);
  });

  it('ignores other files, including one with the same name elsewhere', () => {
    expect(
      touchesRepoFile(
        [file('modify', 'index.html'), file('modify', 'site/index.html.bak')],
        'site/index.html'
      )
    ).toBe(false);
  });

  it('matches a tab path written with Windows separators', () => {
    expect(touchesRepoFile([file('modify', 'site/index.html')], 'site\\index.html')).toBe(true);
  });

  it('finds the file anywhere in a batch', () => {
    expect(
      touchesRepoFile(
        [file('modify', 'a.ts'), file('modify', 'site/index.html'), file('delete', 'b.ts')],
        'site/index.html'
      )
    ).toBe(true);
    expect(touchesRepoFile([], 'site/index.html')).toBe(false);
  });
});
