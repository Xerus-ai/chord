import { describe, expect, it } from 'vitest';
import { shareLinkUrl, shareScopeOptions } from './share-scope';

const ARTIFACTS = [
  { id: 'a1', name: 'pricing-spec.md' },
  { id: 'a2', name: 'hero.html' },
];

/**
 * The Share dialog's "What" (shared-items design §5): the whole work item or
 * one of its artifacts, with the artifact tab the owner is looking at
 * preselected.
 */
describe('shareScopeOptions', () => {
  it('offers the whole work item, then each artifact', () => {
    expect(shareScopeOptions(ARTIFACTS, null).options).toEqual([
      { value: 'work_item', label: 'Whole work item' },
      { value: 'a1', label: 'pricing-spec.md' },
      { value: 'a2', label: 'hero.html' },
    ]);
  });

  it('preselects the artifact tab that is open', () => {
    expect(shareScopeOptions(ARTIFACTS, 'a2').initial).toEqual({
      kind: 'artifact',
      artifactId: 'a2',
      name: 'hero.html',
    });
  });

  it('preselects the whole work item when no artifact tab is open', () => {
    expect(shareScopeOptions(ARTIFACTS, null).initial).toEqual({ kind: 'work_item' });
  });

  it('throws for an open artifact the list does not have', () => {
    expect(() => shareScopeOptions(ARTIFACTS, 'a9')).toThrow(/a9/);
  });
});

/**
 * Copy link (design §5, amended 2026-09-27): the server's https handoff,
 * which opens the item in Chord for people with access and is clickable in
 * chat and mail, unlike a raw chord:// link.
 */
describe('shareLinkUrl', () => {
  it('links the whole work item', () => {
    expect(shareLinkUrl('https://chord.example/', 'w1', { kind: 'work_item' })).toBe(
      'https://chord.example/open/work-item/w1'
    );
  });

  it('links one artifact', () => {
    expect(
      shareLinkUrl('https://chord.example', 'w1', { kind: 'artifact', artifactId: 'a2', name: 'x' })
    ).toBe('https://chord.example/open/artifact/a2');
  });
});
