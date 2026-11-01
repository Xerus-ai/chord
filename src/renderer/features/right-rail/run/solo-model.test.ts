import { describe, expect, it } from 'vitest';
import type { SoloLaneRef, SoloView } from '@shared/solo';
import { describeStartError } from './run-model';
import { describeSoloError, describeSoloTab, SOLO_COMPOSE_HELP } from './solo-model';

const ROOT = 'C:/repos/app';

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
    rootPath: ROOT,
    holder: null,
    queue: [],
    interrupted: null,
    ...overrides,
  };
}

const held = (laneId: string, queue: string[] = []) =>
  view({ holder: { ...lane(laneId), since: '2026-10-04T10:00:00.000Z' }, queue: queue.map(lane) });

describe('describeSoloTab', () => {
  it('offers Solo this branch on a free slot', () => {
    expect(describeSoloTab(view(), 'lane-a')).toEqual({
      status: null,
      action: { kind: 'solo', label: 'Solo this branch' },
      holding: false,
      files: [],
    });
  });

  it('offers to queue behind the holder, named by its work item and branch', () => {
    expect(describeSoloTab(held('lane-b', ['lane-c']), 'lane-a')).toEqual({
      status: 'Item b is soloing on chord/b',
      action: { kind: 'queue', label: 'Queue (2 ahead)' },
      holding: false,
      files: [],
    });
    expect(describeSoloTab(held('lane-b'), 'lane-a').action).toEqual({
      kind: 'queue',
      label: 'Queue (1 ahead)',
    });
  });

  it('names a holder on a detached HEAD by its work item alone', () => {
    const solo = view({
      holder: { ...lane('lane-b'), branch: null, since: '2026-10-04T10:00:00.000Z' },
    });

    expect(describeSoloTab(solo, 'lane-a').status).toBe('Item b is soloing');
  });

  it("says a queued lane's place in line and offers Leave queue", () => {
    expect(describeSoloTab(held('lane-b', ['lane-c', 'lane-a']), 'lane-a')).toEqual({
      status: 'Queued · 2 ahead',
      action: { kind: 'leave', label: 'Leave queue' },
      holding: false,
      files: [],
    });
    expect(describeSoloTab(held('lane-b', ['lane-a']), 'lane-a').status).toBe('Queued · 1 ahead');
  });

  it('says where the holder runs, with no Solo button: its rows, Sync and Release act', () => {
    expect(describeSoloTab(held('lane-a', ['lane-b']), 'lane-a')).toEqual({
      status: `Soloing in ${ROOT}`,
      action: null,
      holding: true,
      files: [],
    });
  });

  it('shows an interrupted Solo with its changed files and Restore, to every lane', () => {
    const interrupted = view({
      interrupted: { laneId: 'lane-b', branch: 'chord/b', files: ['README.md', 'scratch.md'] },
    });
    const expected = {
      status: 'Solo of chord/b was interrupted',
      action: { kind: 'restore', label: 'Restore' },
      holding: false,
      files: ['README.md', 'scratch.md'],
    };

    expect(describeSoloTab(interrupted, 'lane-a')).toEqual(expected);
    expect(describeSoloTab(interrupted, 'lane-b')).toEqual(expected);
  });

  it('says so, rather than leaving a blank, when the interrupted lane is gone', () => {
    const interrupted = view({ interrupted: { laneId: 'lane-x', branch: null, files: ['a.md'] } });

    expect(describeSoloTab(interrupted, 'lane-a').status).toBe(
      'Solo of a deleted branch was interrupted'
    );
  });
});

describe('describeSoloError', () => {
  it('lists a dirty root and says to commit or stash in the root, with no discard', () => {
    expect(
      describeSoloError({ type: 'root_dirty', files: ['dirty.md', 'src/x.ts'] }, ROOT)
    ).toEqual({
      message: `Commit or stash these in ${ROOT} first`,
      files: ['dirty.md', 'src/x.ts'],
      offerDiscard: false,
    });
  });

  it('lists a root changed during Solo and offers Discard and release', () => {
    const described = describeSoloError({ type: 'root_changed', files: ['scratch.md'] }, ROOT);

    expect(described.files).toEqual(['scratch.md']);
    expect(described.offerDiscard).toBe(true);
    expect(described.message).toContain(ROOT);
  });

  it('words the other refusals without files', () => {
    for (const error of [
      { type: 'not_solo_mode' as const },
      { type: 'solo_interrupted' as const },
      { type: 'solo_held' as const, laneId: 'lane-z' },
      { type: 'root_busy' as const, operation: 'rebase' as const },
      { type: 'solo_not_held' as const },
      { type: 'not_queued' as const },
      { type: 'declined' as const },
      { type: 'setup_running' as const },
      { type: 'no_script' as const },
    ]) {
      const described = describeSoloError(error, ROOT);
      expect(described.files).toEqual([]);
      expect(described.offerDiscard).toBe(false);
      expect(described.message.length).toBeGreaterThan(0);
    }
    expect(describeSoloError({ type: 'root_busy', operation: 'rebase' }, ROOT).message).toContain(
      'rebase'
    );
  });
});

describe('Solo wording elsewhere in the Run tab', () => {
  it('says how a compose run script keeps one stack across branches', () => {
    expect(SOLO_COMPOSE_HELP).toContain('docker compose up --remove-orphans');
  });

  it('words a solo_mode refusal of a Start in the checkout', () => {
    expect(describeStartError({ type: 'solo_mode' })).toMatch(/Solo/);
  });
});
