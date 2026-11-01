import { describe, expect, it } from 'vitest';
import type { SoloLaneRef, SoloView } from '@shared/solo';
import { describeSoloHeader } from './solo-header-model';

function lane(laneId: string): SoloLaneRef {
  const name = laneId.slice('lane-'.length);
  return {
    laneId,
    workItemId: `item-${name}`,
    workItemName: `Item ${name}`,
    branch: `chord/${name}`,
  };
}

function view(overrides: Partial<SoloView> = {}): SoloView {
  return {
    repoId: 'repo-1',
    rootPath: 'C:/repos/app',
    holder: null,
    queue: [],
    interrupted: null,
    ...overrides,
  };
}

describe('describeSoloHeader', () => {
  it('says nothing while the repository has no Solo, or before its state is read', () => {
    expect(describeSoloHeader(view())).toBeNull();
    expect(describeSoloHeader(undefined)).toBeNull();
  });

  it('names the holder by its work item, its branch on hover, and focuses the work item', () => {
    // Lanes' branches share their prefix ("<user>/<item>-…"), so a branch
    // cut off in the sidebar never says which lane holds the root.
    const solo = view({ holder: { ...lane('lane-a'), since: '2026-10-04T10:00:00.000Z' } });

    expect(describeSoloHeader(solo)).toEqual({
      text: 'Soloing Item a',
      queued: null,
      title: 'Soloing Item a on chord/a',
      action: { kind: 'focus', workItemId: 'item-a' },
    });
  });

  it('names a holder on a detached HEAD by its work item alone', () => {
    const solo = view({
      holder: { ...lane('lane-a'), branch: null, since: '2026-10-04T10:00:00.000Z' },
    });

    expect(describeSoloHeader(solo)).toMatchObject({
      text: 'Soloing Item a',
      title: 'Soloing Item a',
    });
  });

  it('says how many lanes queue apart from the name, so a long name never hides it', () => {
    const solo = view({
      holder: { ...lane('lane-a'), since: '2026-10-04T10:00:00.000Z' },
      queue: [lane('lane-b'), lane('lane-c')],
    });

    expect(describeSoloHeader(solo)).toMatchObject({
      text: 'Soloing Item a',
      queued: '2 queued',
      title: 'Soloing Item a on chord/a · 2 queued',
    });
  });

  it('shows an interrupted Solo with Restore', () => {
    const solo = view({ interrupted: { laneId: 'lane-a', branch: 'chord/a', files: ['x.md'] } });

    expect(describeSoloHeader(solo)).toEqual({
      text: 'Solo interrupted',
      queued: null,
      title: 'Solo interrupted',
      action: { kind: 'restore' },
    });
  });
});
