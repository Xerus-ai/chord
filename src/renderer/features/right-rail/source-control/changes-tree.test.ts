import { describe, expect, it } from 'vitest';
import type { GitChange } from '@shared/git';
import { buildChangesTree, resolveChangesGroupOrder, type ChangesTreeRow } from './changes-tree';

function change(
  path: string,
  added = 1,
  deleted = 0,
  status: GitChange['status'] = 'modified'
): GitChange {
  return { path, status, additions: added, deletions: deleted };
}

/** Folder rows only, as `path → +A −D`, for the totals assertions. */
function folderTotals(rows: ChangesTreeRow[]): Record<string, string> {
  return Object.fromEntries(
    rows
      .filter((row) => row.kind === 'folder')
      .map((row) => [row.path, `+${row.added} -${row.removed}`])
  );
}

function names(rows: ChangesTreeRow[]): string[] {
  return rows.map((row) => `${'  '.repeat(row.depth)}${row.name}`);
}

describe('buildChangesTree', () => {
  it('sums a folder’s totals from every file under it, however deep', () => {
    const rows = buildChangesTree(
      {
        staged: [],
        unstaged: [
          change('src/a/one.ts', 10, 2),
          change('src/a/two.ts', 5, 1),
          change('src/b.ts', 1, 1),
        ],
        conflicts: [],
        untracked: [],
      },
      new Set(),
      'changes'
    );

    expect(folderTotals(rows)).toMatchObject({ src: '+16 -4', 'src/a': '+15 -3' });
  });

  it('collapses a chain of single-child folders into one row', () => {
    const rows = buildChangesTree(
      {
        staged: [],
        unstaged: [change('src/renderer/features/rail.tsx')],
        conflicts: [],
        untracked: [],
      },
      new Set(),
      'changes'
    );

    expect(names(rows)).toEqual(['CHANGES', '  src/renderer/features', '    rail.tsx']);
  });

  it('stops collapsing where a folder genuinely branches', () => {
    const rows = buildChangesTree(
      {
        staged: [],
        unstaged: [change('src/renderer/rail.tsx'), change('src/main/db.ts')],
        conflicts: [],
        untracked: [],
      },
      new Set(),
      'changes'
    );

    expect(names(rows)).toEqual([
      'CHANGES',
      '  src',
      '    main',
      '      db.ts',
      '    renderer',
      '      rail.tsx',
    ]);
  });

  it('keeps the totals right through a collapsed chain', () => {
    const rows = buildChangesTree(
      {
        staged: [],
        unstaged: [change('a/b/c/one.ts', 4, 3), change('a/b/c/two.ts', 6, 1)],
        conflicts: [],
        untracked: [],
      },
      new Set(),
      'changes'
    );

    expect(folderTotals(rows)).toEqual({ 'a/b/c': '+10 -4' });
  });

  it('shows a file that is both staged and modified in both groups', () => {
    const rows = buildChangesTree(
      {
        staged: [change('src/rail.tsx', 3, 0)],
        unstaged: [change('src/rail.tsx', 1, 1)],
        conflicts: [],
        untracked: [],
      },
      new Set(),
      'changes'
    );

    const files = rows.filter((row) => row.kind === 'file' && row.name === 'rail.tsx');
    expect(files).toHaveLength(2);
    expect(files.map((row) => row.group)).toEqual(['unstaged', 'staged']);
  });

  it('never offers Discard on a conflicted row', () => {
    const rows = buildChangesTree(
      {
        staged: [],
        unstaged: [change('src/ok.ts')],
        conflicts: [change('src/clash.ts', 0, 0, 'conflicted')],
        untracked: [],
      },
      new Set(),
      'changes'
    );

    const conflicted = rows.find((row) => row.kind === 'file' && row.name === 'clash.ts');
    const ordinary = rows.find((row) => row.kind === 'file' && row.name === 'ok.ts');
    expect(conflicted?.kind === 'file' && conflicted.canDiscard).toBe(false);
    expect(ordinary?.kind === 'file' && ordinary.canDiscard).toBe(true);
  });

  it('puts conflicts first — they block every other action', () => {
    const rows = buildChangesTree(
      {
        staged: [change('s.ts')],
        unstaged: [change('u.ts')],
        conflicts: [change('c.ts', 0, 0, 'conflicted')],
        untracked: [],
      },
      new Set(),
      'changes'
    );

    expect(rows.filter((row) => row.kind === 'group').map((row) => row.name)).toEqual([
      'CONFLICTS',
      'CHANGES',
      'STAGED',
    ]);
  });

  it('hides the rows under a collapsed folder, and the folder keeps its totals', () => {
    const rows = buildChangesTree(
      {
        staged: [],
        unstaged: [change('src/a.ts', 2, 0), change('src/b.ts', 3, 0)],
        conflicts: [],
        untracked: [],
      },
      new Set(['unstaged:src']),
      'changes'
    );

    expect(names(rows)).toEqual(['CHANGES', '  src']);
    expect(folderTotals(rows)).toEqual({ src: '+5 -0' });
  });

  it('renders nothing for a group with no changes', () => {
    const rows = buildChangesTree(
      { staged: [], unstaged: [change('a.ts')], conflicts: [], untracked: [] },
      new Set(),
      'changes'
    );

    expect(rows.filter((row) => row.kind === 'group').map((row) => row.name)).toEqual(['CHANGES']);
  });
});

/**
 * Settings › Git › Source control group order (presets): which of Changes,
 * Staged and Untracked is listed first. The other two keep their default
 * relative order, and Conflicts stays pinned above all three.
 */
describe('resolveChangesGroupOrder', () => {
  it('lists Changes, then Staged, then Untracked by default', () => {
    expect(resolveChangesGroupOrder('changes')).toEqual([
      'conflicts',
      'unstaged',
      'staged',
      'untracked',
    ]);
  });

  it('lists Staged first when chosen', () => {
    expect(resolveChangesGroupOrder('staged')).toEqual([
      'conflicts',
      'staged',
      'unstaged',
      'untracked',
    ]);
  });

  it('lists Untracked first when chosen', () => {
    expect(resolveChangesGroupOrder('untracked')).toEqual([
      'conflicts',
      'untracked',
      'unstaged',
      'staged',
    ]);
  });
});

describe('buildChangesTree group order', () => {
  const everyGroup = {
    staged: [change('s.ts')],
    unstaged: [change('u.ts')],
    conflicts: [change('c.ts', 0, 0, 'conflicted')],
    untracked: [change('n.ts', 4, 0, 'added')],
  };
  const groupNames = (rows: ChangesTreeRow[]) =>
    rows.filter((row) => row.kind === 'group').map((row) => row.name);

  it('follows the chosen order, Conflicts pinned first', () => {
    expect(groupNames(buildChangesTree(everyGroup, new Set(), 'changes'))).toEqual([
      'CONFLICTS',
      'CHANGES',
      'STAGED',
      'UNTRACKED',
    ]);
    expect(groupNames(buildChangesTree(everyGroup, new Set(), 'staged'))).toEqual([
      'CONFLICTS',
      'STAGED',
      'CHANGES',
      'UNTRACKED',
    ]);
    expect(groupNames(buildChangesTree(everyGroup, new Set(), 'untracked'))).toEqual([
      'CONFLICTS',
      'UNTRACKED',
      'CHANGES',
      'STAGED',
    ]);
  });

  it('gives untracked files their own group, and only there', () => {
    const rows = buildChangesTree(everyGroup, new Set(), 'untracked');
    const newFile = rows.filter((row) => row.kind === 'file' && row.name === 'n.ts');
    expect(newFile.map((row) => row.group)).toEqual(['untracked']);
    expect(rows.find((row) => row.kind === 'group' && row.group === 'untracked')).toMatchObject({
      count: 1,
      added: 4,
    });
  });
});
