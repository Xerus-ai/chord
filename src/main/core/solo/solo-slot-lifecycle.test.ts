import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { neverAsk, readLaneRow, REPO_ID } from '@main/core/lane-runs/_testing/lane-run-fixture';
import { isRunning } from '@main/core/lane-runs/_testing/run-process';
import { readLaneRunState } from '@main/core/lane-runs/lane-run-registry';
import { deleteWorkItem } from '@main/core/work-items/work-item-crud';
import { archiveWorktree } from '@main/core/worktrees/archive-worktree';
import { deleteWorktree } from '@main/core/worktrees/delete-worktree';
import { db } from '@main/db/client';
import { workItems } from '@main/db/schema-work-items';
import {
  branchOf,
  hashRootFiles,
  headOf,
  sawCtrlC,
  waitForRunMark,
} from './_testing/solo-slot-fixture';
import { expectRootReturned, holdSoloSlot, useSoloSuite } from './_testing/solo-slot-suite';
import { acquireSoloHost } from './acquire-solo-host';
import { readSoloView } from './read-solo-view';
import { releaseSolo } from './release-solo';
import { hasSoloHolds, recoverSoloSlotsOnBoot, settleSoloOnQuit } from './solo-boot';
import { soloLane } from './solo-lane';
import { readSoloState } from './solo-state';

/**
 * The Solo slot across a lane's and the app's lifetime (plan §"Decisions for
 * Phase 4", Slot + queue and Solo host): a queued lane that is archived or
 * deleted leaves the queue; deleting the holder releases first — and is
 * refused, never silently discarding, when the root changed; boot settles a
 * hold a previous run left (released, or shown as interrupted with Restore);
 * quitting stops the holder's runs and releases an unchanged root. Real
 * repository and lanes, the real delete and archive paths; Electron's
 * keychain, the database and the IPC emitter are the substitutes the other
 * worktree suites use.
 */
vi.mock('electron', () => import('@main/core/account/_testing/test-keychain-electron'));
vi.mock('@main/db/client', () => import('@main/db/_testing/test-db-client'));
vi.mock('@main/lib/events', () => ({
  events: { emit: () => {}, on: () => () => {}, once: () => () => {} },
}));

/** item-a: primary lane-a, secondary lane-a2; item-b: primary lane-b, secondary lane-b2. */
const LANES = [
  { laneId: 'lane-a', workItemId: 'item-a', dir: 'a', isPrimary: true },
  { laneId: 'lane-a2', workItemId: 'item-a', dir: 'a2', isPrimary: false },
  { laneId: 'lane-b', workItemId: 'item-b', dir: 'b', isPrimary: true },
  { laneId: 'lane-b2', workItemId: 'item-b', dir: 'b2', isPrimary: false },
] as const;

describe('the Solo slot across lane and app lifetimes', () => {
  const suite = useSoloSuite('solo-lifecycle-', LANES);
  const { lanePaths } = suite;
  let root: string;
  beforeEach(() => {
    root = suite.root;
  });
  const holdWith = (laneId: string) => holdSoloSlot(root, laneId);

  const queueOf = async () => (await readSoloView(REPO_ID)).queue.map((entry) => entry.laneId);

  describe('lanes going', () => {
    it('a queued lane that is archived leaves the queue', async () => {
      await holdWith('lane-a');
      await soloLane('lane-b2', neverAsk);
      await soloLane('lane-b', neverAsk);

      expect((await archiveWorktree('lane-b2')).success).toBe(true);

      expect(await queueOf()).toEqual(['lane-b']);
    });

    it('the queued lanes of a deleted work item leave the queue', async () => {
      await holdWith('lane-a');
      await soloLane('lane-b', neverAsk);
      await soloLane('lane-b2', neverAsk);

      expect(await deleteWorkItem('item-b')).toEqual({ success: true, data: undefined });

      expect(await queueOf()).toEqual([]);
      expect((await readSoloView(REPO_ID)).holder?.laneId).toBe('lane-a');
    });

    it('deleting the holder releases first: its runs stop, the root is back on its branch byte for byte', async () => {
      const before = hashRootFiles(root);
      const head = await headOf(root);
      const mark = await holdWith('lane-a2');

      const result = await deleteWorktree('lane-a2');

      expect(result).toEqual({ success: true, data: { workItemId: 'item-a' } });
      expect(sawCtrlC(root, 'lane-a2')).toBe(true);
      expect(await isRunning(mark.process)).toBe(false);
      await expectRootReturned(root, before, head);
      expect((await readSoloState(root)).status).toBe('none');
      expect(fs.existsSync(lanePaths['lane-a2'])).toBe(false);
      expect(await readSoloView(REPO_ID)).toMatchObject({ holder: null, queue: [] });
    });

    it('deleting the holder hands the slot to the next queued lane', async () => {
      await holdWith('lane-a2');
      await soloLane('lane-b', neverAsk);

      expect((await deleteWorktree('lane-a2')).success).toBe(true);

      expect((await waitForRunMark(root, 'lane-b')).solo).toBe('1');
      expect(await headOf(root)).toBe(await headOf(lanePaths['lane-b']));
      expect(await readSoloView(REPO_ID)).toMatchObject({
        holder: { laneId: 'lane-b' },
        queue: [],
      });
    });

    it('deleting or archiving the holder is refused while the root changed during Solo; nothing is removed', async () => {
      const mark = await holdWith('lane-a2');
      fs.writeFileSync(path.join(root, 'scratch.md'), 'edited in the root\n');
      const refusal = {
        success: false,
        error: { type: 'solo_root_changed', files: ['scratch.md'], message: expect.any(String) },
      };

      expect(await deleteWorktree('lane-a2')).toEqual(refusal);
      expect(await archiveWorktree('lane-a2')).toEqual(refusal);
      expect(await deleteWorkItem('item-a')).toEqual(refusal);

      expect(readLaneRow('lane-a2')).toBeDefined();
      expect(fs.existsSync(lanePaths['lane-a2'])).toBe(true);
      expect(
        db
          .select()
          .from(workItems)
          .all()
          .map((item) => item.id)
      ).toContain('item-a');
      expect(await isRunning(mark.process)).toBe(true);
      expect((await readSoloView(REPO_ID)).holder?.laneId).toBe('lane-a2');
      expect(fs.readFileSync(path.join(root, 'scratch.md'), 'utf8')).toBe('edited in the root\n');
    });
  });

  describe('boot', () => {
    async function leaveHoldFromPreviousRun(): Promise<void> {
      const held = await acquireSoloHost({
        rootPath: root,
        laneId: 'lane-a',
        laneCheckoutPath: lanePaths['lane-a'],
      });
      if (!held.success) throw new Error(`acquire refused: ${JSON.stringify(held.error)}`);
    }

    it('releases a hold a previous run left on a root that is unchanged', async () => {
      const before = hashRootFiles(root);
      const head = await headOf(root);
      await leaveHoldFromPreviousRun();

      await recoverSoloSlotsOnBoot();

      expect((await readSoloState(root)).status).toBe('none');
      expect(hashRootFiles(root)).toEqual(before);
      expect(await headOf(root)).toBe(head);
      expect(await branchOf(root)).toBe('main');
      expect(await readSoloView(REPO_ID)).toMatchObject({ holder: null, interrupted: null });
    });

    it('shows a changed root as interrupted; Restore lists the files and Discard releases it byte for byte', async () => {
      const before = hashRootFiles(root);
      const head = await headOf(root);
      await leaveHoldFromPreviousRun();
      fs.writeFileSync(path.join(root, 'scratch.md'), 'edited in the root\n');

      await recoverSoloSlotsOnBoot();

      expect(await readSoloView(REPO_ID)).toMatchObject({
        holder: null,
        queue: [],
        interrupted: { laneId: 'lane-a', branch: 'chord/a', files: ['scratch.md'] },
      });
      expect((await readSoloState(root)).status).toBe('held');
      expect(await soloLane('lane-b', neverAsk)).toEqual({
        success: false,
        error: { type: 'solo_interrupted' },
      });

      expect(
        await releaseSolo({ repoId: REPO_ID }, { discardRootChanges: false }, neverAsk)
      ).toEqual({ success: false, error: { type: 'root_changed', files: ['scratch.md'] } });
      const restored = await releaseSolo(
        { repoId: REPO_ID },
        { discardRootChanges: true },
        neverAsk
      );

      expect(restored).toMatchObject({
        success: true,
        data: { releasedLaneId: 'lane-a', handedTo: null },
      });
      await expectRootReturned(root, before, head);
      expect(await readSoloView(REPO_ID)).toMatchObject({ holder: null, interrupted: null });
    });
  });

  describe('quit', () => {
    it("stops the holder's runs with Ctrl+C and releases an unchanged root", async () => {
      const before = hashRootFiles(root);
      const mark = await holdWith('lane-a');
      await soloLane('lane-b', neverAsk);
      expect(hasSoloHolds()).toBe(true);

      await settleSoloOnQuit();

      expect(sawCtrlC(root, 'lane-a')).toBe(true);
      expect(await isRunning(mark.process)).toBe(false);
      expect(readLaneRunState('lane-b').scripts).toEqual({});
      expect((await readSoloState(root)).status).toBe('none');
      expect(hashRootFiles(root)).toEqual(before);
      expect(await branchOf(root)).toBe('main');
      expect(hasSoloHolds()).toBe(false);
    });

    it('leaves a root changed during Solo held, for boot to show as interrupted', async () => {
      const mark = await holdWith('lane-a');
      fs.writeFileSync(path.join(root, 'scratch.md'), 'edited in the root\n');

      await settleSoloOnQuit();

      expect(await isRunning(mark.process)).toBe(false);
      expect((await readSoloState(root)).status).toBe('held');
      expect(fs.readFileSync(path.join(root, 'scratch.md'), 'utf8')).toBe('edited in the root\n');
    });
  });
});
