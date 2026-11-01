import { describe, expect, it } from 'vitest';
import {
  effectivePathMode,
  pathFormat,
  pathModeLabel,
  resolvePathModes,
  type PathFormat,
} from './path-tab-modes';

/**
 * Which of Diff · Preview · Edit a path tab offers (design 2026-09-26 §3):
 * Preview for every format that has one, Diff only when the path has
 * changes, Edit only for someone who can edit, and an artifact with no file
 * only Preview.
 */
describe('pathFormat', () => {
  it('takes an artifact’s format from its render class', () => {
    expect(pathFormat({ filePath: 'a/hero.html', renderClass: 'page' })).toBe('page');
    expect(pathFormat({ filePath: 'notes.txt', renderClass: 'document' })).toBe('document');
    expect(pathFormat({ filePath: 'deck.pptx', renderClass: 'file' })).toBe('binary');
    expect(pathFormat({ filePath: undefined, renderClass: 'document' })).toBe('document');
  });

  it('takes a plain file’s format from its extension', () => {
    expect(pathFormat({ filePath: 'site/index.html' })).toBe('page');
    expect(pathFormat({ filePath: 'ui/Hero.tsx' })).toBe('page');
    expect(pathFormat({ filePath: 'docs/intro.mdx' })).toBe('page');
    expect(pathFormat({ filePath: 'README.md' })).toBe('markdown');
    expect(pathFormat({ filePath: 'report.pdf' })).toBe('binary');
    expect(pathFormat({ filePath: 'logo.png' })).toBe('binary');
    // A .txt is only a document as an artifact; as a file it is source.
    expect(pathFormat({ filePath: 'notes.txt' })).toBe('source');
    expect(pathFormat({ filePath: 'src/main.ts' })).toBe('source');
  });
});

describe('resolvePathModes', () => {
  const owner = { hasFile: true, allowed: ['diff', 'preview', 'edit'] as const };

  it.each(['page', 'document', 'markdown'] as PathFormat[])(
    'a %s previews by default; Diff appears only with changes',
    (format) => {
      expect(resolvePathModes({ format, ...owner, hasChanges: false })).toEqual({
        modes: ['preview', 'edit'],
        defaultMode: 'preview',
      });
      expect(resolvePathModes({ format, ...owner, hasChanges: true })).toEqual({
        modes: ['diff', 'preview', 'edit'],
        defaultMode: 'preview',
      });
    }
  );

  it('a binary file only previews, changed or not', () => {
    expect(resolvePathModes({ format: 'binary', ...owner, hasChanges: true })).toEqual({
      modes: ['preview'],
      defaultMode: 'preview',
    });
  });

  it('source has no preview and defaults to Edit', () => {
    expect(resolvePathModes({ format: 'source', ...owner, hasChanges: false })).toEqual({
      modes: ['edit'],
      defaultMode: 'edit',
    });
    expect(resolvePathModes({ format: 'source', ...owner, hasChanges: true })).toEqual({
      modes: ['diff', 'edit'],
      defaultMode: 'edit',
    });
  });

  it('a teammate sees an artifact as Diff where changed, and Preview; never Edit', () => {
    const teammate = { hasFile: true, allowed: ['diff', 'preview'] as const };
    expect(resolvePathModes({ format: 'page', ...teammate, hasChanges: true })).toEqual({
      modes: ['diff', 'preview'],
      defaultMode: 'preview',
    });
    expect(resolvePathModes({ format: 'document', ...teammate, hasChanges: false })).toEqual({
      modes: ['preview'],
      defaultMode: 'preview',
    });
  });

  it("a teammate sees a plain file only as its diff (the repo is on the owner's machine)", () => {
    const teammate = { hasFile: true, allowed: ['diff'] as const };
    expect(resolvePathModes({ format: 'source', ...teammate, hasChanges: true })).toEqual({
      modes: ['diff'],
      defaultMode: 'diff',
    });
    expect(resolvePathModes({ format: 'markdown', ...teammate, hasChanges: true })).toEqual({
      modes: ['diff'],
      defaultMode: 'diff',
    });
  });

  it('keeps Diff for a file whose changes left the snapshot: its body says so', () => {
    expect(
      resolvePathModes({ format: 'source', hasFile: true, allowed: ['diff'], hasChanges: false })
    ).toEqual({ modes: ['diff'], defaultMode: 'diff' });
  });

  it('an artifact reached through artifacts only is its Preview', () => {
    expect(
      resolvePathModes({ format: 'page', hasFile: true, allowed: ['preview'], hasChanges: true })
    ).toEqual({ modes: ['preview'], defaultMode: 'preview' });
  });

  it('an artifact with no file only previews', () => {
    expect(
      resolvePathModes({
        format: 'document',
        hasFile: false,
        allowed: owner.allowed,
        hasChanges: true,
      })
    ).toEqual({ modes: ['preview'], defaultMode: 'preview' });
  });

  it('refuses a document nothing can show', () => {
    expect(() =>
      resolvePathModes({ format: 'source', hasFile: true, allowed: ['preview'], hasChanges: false })
    ).toThrow();
  });
});

describe('effectivePathMode', () => {
  const resolved = { modes: ['preview', 'edit'] as const, defaultMode: 'preview' as const };

  it('shows the tab’s own mode when it is offered', () => {
    expect(effectivePathMode('edit', resolved)).toBe('edit');
  });

  it('shows the default when the tab has none, or its mode is gone (the diff was committed)', () => {
    expect(effectivePathMode(undefined, resolved)).toBe('preview');
    expect(effectivePathMode('diff', resolved)).toBe('preview');
  });
});

describe('pathModeLabel', () => {
  it('names Edit "Source" for someone who cannot edit', () => {
    expect(pathModeLabel('edit', true)).toBe('Edit');
    expect(pathModeLabel('edit', false)).toBe('Source');
    expect(pathModeLabel('diff', false)).toBe('Diff');
    expect(pathModeLabel('preview', true)).toBe('Preview');
  });
});
