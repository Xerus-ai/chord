import { describe, expect, it } from 'vitest';
import {
  filterByName,
  flattenTree,
  pendingDirectories,
  toggleDirectory,
  type DirectoryListings,
} from './tree';

const LISTINGS: DirectoryListings = new Map([
  [
    '',
    [
      { path: 'src', type: 'dir' as const },
      { path: 'README.md', type: 'file' as const },
      { path: 'docs', type: 'dir' as const },
    ],
  ],
  [
    'src',
    [
      { path: 'src/index.ts', type: 'file' as const },
      { path: 'src/lib', type: 'dir' as const },
    ],
  ],
  ['src/lib', [{ path: 'src/lib/util.ts', type: 'file' as const }]],
  ['docs', [{ path: 'docs/design.md', type: 'file' as const }]],
]);

describe('flattenTree', () => {
  it('sorts directories before files, then by name', () => {
    expect(flattenTree(LISTINGS, new Set()).map((node) => node.path)).toEqual([
      'docs',
      'src',
      'README.md',
    ]);
  });

  it('shows the children of an expanded directory, indented one level', () => {
    const rows = flattenTree(LISTINGS, new Set(['src']));
    expect(rows.map((node) => [node.path, node.depth])).toEqual([
      ['docs', 0],
      ['src', 0],
      ['src/lib', 1],
      ['src/index.ts', 1],
      ['README.md', 0],
    ]);
  });

  it('nests deeper expansions under their parent', () => {
    const rows = flattenTree(LISTINGS, new Set(['src', 'src/lib']));
    expect(rows.map((node) => node.path)).toEqual([
      'docs',
      'src',
      'src/lib',
      'src/lib/util.ts',
      'src/index.ts',
      'README.md',
    ]);
  });

  it('renders nothing under a directory whose listing has not arrived', () => {
    const partial: DirectoryListings = new Map([['', LISTINGS.get('')!]]);
    const rows = flattenTree(partial, new Set(['src']));
    expect(rows.map((node) => node.path)).toEqual(['docs', 'src', 'README.md']);
    expect(rows.find((node) => node.path === 'src')?.expanded).toBe(true);
  });
});

describe('pendingDirectories', () => {
  it('names only the expanded directories with no listing yet', () => {
    expect(pendingDirectories(LISTINGS, new Set(['src', 'src/lib']))).toEqual([]);
    expect(pendingDirectories(LISTINGS, new Set(['src', 'tests']))).toEqual(['tests']);
  });
});

describe('toggleDirectory', () => {
  it('expands a collapsed directory', () => {
    expect([...toggleDirectory(new Set(), 'src')]).toEqual(['src']);
  });

  it('collapsing a directory also forgets its descendants', () => {
    const expanded = new Set(['src', 'src/lib', 'src/lib/deep', 'docs']);
    expect([...toggleDirectory(expanded, 'src')].sort()).toEqual(['docs']);
  });

  it('leaves a sibling with a shared prefix alone', () => {
    const expanded = new Set(['src', 'src-gen']);
    expect([...toggleDirectory(expanded, 'src')]).toEqual(['src-gen']);
  });
});

describe('filterByName', () => {
  const paths = ['src/index.ts', 'src/index-utils/helper.ts', 'docs/index.md'];

  it('returns nothing for an empty query rather than everything', () => {
    expect(filterByName(paths, '   ')).toEqual([]);
  });

  it('ranks file-name matches above matches elsewhere in the path', () => {
    expect(filterByName(paths, 'index')).toEqual([
      'src/index.ts',
      'docs/index.md',
      'src/index-utils/helper.ts',
    ]);
  });

  it('is case-insensitive and honours the limit', () => {
    expect(filterByName(paths, 'INDEX.TS')).toEqual(['src/index.ts']);
    expect(filterByName(paths, 'index', 2)).toHaveLength(2);
  });
});
