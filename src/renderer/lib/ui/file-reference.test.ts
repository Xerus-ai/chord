import { describe, expect, it } from 'vitest';
import { fuzzyMatchFiles, resolveFileReference } from './file-reference';

const REPO_FILES = new Set([
  'src/renderer/features/work-list/chat-panel.tsx',
  'src/main/core/work-items/controller.ts',
  'src/shared/stream-items.ts',
  'package.json',
  'docs/design-system-v2.md',
  'scripts/release/build.ts',
]);

describe('resolveFileReference', () => {
  it('resolves an exact repo-relative path', () => {
    expect(resolveFileReference('src/shared/stream-items.ts', REPO_FILES)).toEqual({
      path: 'src/shared/stream-items.ts',
    });
  });

  it('resolves a top-level file', () => {
    expect(resolveFileReference('package.json', REPO_FILES)).toEqual({ path: 'package.json' });
  });

  it('strips a leading ./', () => {
    expect(resolveFileReference('./package.json', REPO_FILES)).toEqual({ path: 'package.json' });
  });

  it('normalizes backslashes to forward slashes', () => {
    expect(resolveFileReference('src\\shared\\stream-items.ts', REPO_FILES)).toEqual({
      path: 'src/shared/stream-items.ts',
    });
  });

  it('extracts a :line suffix', () => {
    expect(resolveFileReference('src/shared/stream-items.ts:42', REPO_FILES)).toEqual({
      path: 'src/shared/stream-items.ts',
      line: 42,
    });
  });

  it('extracts a :line:column suffix, keeping only the line', () => {
    expect(
      resolveFileReference('src/main/core/work-items/controller.ts:120:7', REPO_FILES)
    ).toEqual({
      path: 'src/main/core/work-items/controller.ts',
      line: 120,
    });
  });

  it('trims surrounding whitespace', () => {
    expect(resolveFileReference('  package.json  ', REPO_FILES)).toEqual({ path: 'package.json' });
  });

  it('returns null for a path not in the repo', () => {
    expect(resolveFileReference('src/made/up/file.ts', REPO_FILES)).toBeNull();
  });

  it('returns null for ordinary inline code', () => {
    expect(resolveFileReference('const x = 1', REPO_FILES)).toBeNull();
    expect(resolveFileReference('npm install', REPO_FILES)).toBeNull();
  });

  it('returns null for empty or whitespace-only text', () => {
    expect(resolveFileReference('', REPO_FILES)).toBeNull();
    expect(resolveFileReference('   ', REPO_FILES)).toBeNull();
  });

  it('returns null for multi-line text', () => {
    expect(resolveFileReference('package.json\nsrc/shared/stream-items.ts', REPO_FILES)).toBeNull();
  });

  it('does not treat a bare :suffix as a line number for a non-existent base', () => {
    expect(resolveFileReference('label:value', REPO_FILES)).toBeNull();
  });
});

describe('fuzzyMatchFiles', () => {
  const FILES = [...REPO_FILES];

  it('matches by contiguous basename substring first', () => {
    const results = fuzzyMatchFiles('chat-panel', FILES, 10);
    expect(results[0]).toBe('src/renderer/features/work-list/chat-panel.tsx');
  });

  it('matches by subsequence across the path', () => {
    const results = fuzzyMatchFiles('wrkctrl', FILES, 10);
    expect(results).toContain('src/main/core/work-items/controller.ts');
  });

  it('ranks basename matches above directory-only matches', () => {
    const results = fuzzyMatchFiles('stream', FILES, 10);
    expect(results[0]).toBe('src/shared/stream-items.ts');
  });

  it('is case-insensitive', () => {
    const results = fuzzyMatchFiles('PACKAGE', FILES, 10);
    expect(results[0]).toBe('package.json');
  });

  it('returns all files (bounded by limit) for an empty query', () => {
    expect(fuzzyMatchFiles('', FILES, 3)).toHaveLength(3);
    expect(fuzzyMatchFiles('', FILES, 100)).toHaveLength(FILES.length);
  });

  it('respects the limit', () => {
    expect(fuzzyMatchFiles('s', FILES, 2)).toHaveLength(2);
  });

  it('returns empty for a query no file can satisfy', () => {
    expect(fuzzyMatchFiles('zzzzqqqq', FILES, 10)).toEqual([]);
  });
});
