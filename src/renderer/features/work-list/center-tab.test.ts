import { describe, expect, it } from 'vitest';
import { artifactPathTab, centerTabKey, centerTabsEqual, filePathTab } from './center-tab';

/**
 * One tab per path (design 2026-09-26 §3): Files, Changes, the rail's
 * ARTIFACTS and a chat chip all address the same `path` tab.
 */
describe('path tab constructors', () => {
  it('builds a file tab titled by its basename', () => {
    expect(filePathTab('src/ui/hero.html')).toEqual({
      kind: 'path',
      filePath: 'src/ui/hero.html',
      title: 'hero.html',
    });
    expect(filePathTab('a.ts', { worktreeId: 'w1', line: 3, mode: 'diff' })).toEqual({
      kind: 'path',
      filePath: 'a.ts',
      title: 'a.ts',
      worktreeId: 'w1',
      line: 3,
      mode: 'diff',
    });
  });

  it('builds an artifact tab, with its repo path when it has one', () => {
    expect(artifactPathTab('a1', 'Spec')).toEqual({
      kind: 'path',
      artifactId: 'a1',
      title: 'Spec',
    });
    expect(artifactPathTab('a1', 'Spec', { filePath: 'docs/spec.md' })).toEqual({
      kind: 'path',
      artifactId: 'a1',
      title: 'Spec',
      filePath: 'docs/spec.md',
    });
  });
});

describe('centerTabsEqual', () => {
  it('separates sessions by id', () => {
    expect(
      centerTabsEqual({ kind: 'session', sessionId: 's1' }, { kind: 'session', sessionId: 's1' })
    ).toBe(true);
    expect(
      centerTabsEqual({ kind: 'session', sessionId: 's1' }, { kind: 'session', sessionId: 's2' })
    ).toBe(false);
  });

  it('matches the same path whatever the mode or line hint', () => {
    expect(
      centerTabsEqual(
        filePathTab('src/a.ts', { mode: 'diff' }),
        filePathTab('src/a.ts', { line: 42 })
      )
    ).toBe(true);
  });

  it('separates different paths', () => {
    expect(centerTabsEqual(filePathTab('src/a.ts'), filePathTab('src/b.ts'))).toBe(false);
  });

  it('treats the same path in different worktrees as different tabs', () => {
    expect(
      centerTabsEqual(
        filePathTab('src/a.ts', { worktreeId: 'w1' }),
        filePathTab('src/a.ts', { worktreeId: 'w2' })
      )
    ).toBe(false);
    // Undefined is the primary worktree and matches only itself.
    expect(
      centerTabsEqual(filePathTab('src/a.ts'), filePathTab('src/a.ts', { worktreeId: 'w1' }))
    ).toBe(false);
  });

  it('matches an artifact opened from ARTIFACTS to the same file opened from Files', () => {
    expect(
      centerTabsEqual(
        artifactPathTab('a1', 'Spec', { filePath: 'docs/spec.md' }),
        filePathTab('docs/spec.md')
      )
    ).toBe(true);
  });

  it('matches artifact tabs by id, ignoring title, when either has no path', () => {
    expect(centerTabsEqual(artifactPathTab('a1', 'old'), artifactPathTab('a1', 'renamed'))).toBe(
      true
    );
    expect(
      centerTabsEqual(
        artifactPathTab('a1', 'Spec'),
        artifactPathTab('a1', 'Spec', { filePath: 'docs/spec.md' })
      )
    ).toBe(true);
    expect(centerTabsEqual(artifactPathTab('a1', 'x'), artifactPathTab('a2', 'x'))).toBe(false);
  });

  it('does not match a bare file to an artifact known only by id (normalization joins them)', () => {
    expect(centerTabsEqual(artifactPathTab('a1', 'Spec'), filePathTab('docs/spec.md'))).toBe(false);
  });

  it('separates commit tabs by worktree and sha', () => {
    const commit = (worktreeId: string, sha: string) => ({
      kind: 'commit' as const,
      worktreeId,
      sha,
    });
    expect(centerTabsEqual(commit('w1', 'abc'), commit('w1', 'abc'))).toBe(true);
    expect(centerTabsEqual(commit('w1', 'abc'), commit('w2', 'abc'))).toBe(false);
    expect(centerTabsEqual(commit('w1', 'abc'), commit('w1', 'def'))).toBe(false);
  });

  it('never matches across kinds', () => {
    expect(centerTabsEqual(filePathTab('a.ts'), { kind: 'session', sessionId: 's1' })).toBe(false);
  });
});

describe('centerTabKey', () => {
  it('keys a path tab by worktree and path, and a pathless artifact by id', () => {
    expect(centerTabKey(filePathTab('a.ts', { worktreeId: 'w1' }))).toBe('path:w1:a.ts');
    expect(centerTabKey(artifactPathTab('a1', 'S', { filePath: 'a.ts' }))).toBe('path::a.ts');
    expect(centerTabKey(artifactPathTab('a1', 'S'))).toBe('artifact:a1');
  });

  it('agrees with centerTabsEqual for the same path from two entry points', () => {
    expect(centerTabKey(filePathTab('docs/spec.md', { mode: 'diff' }))).toBe(
      centerTabKey(artifactPathTab('a1', 'Spec', { filePath: 'docs/spec.md' }))
    );
  });
});
