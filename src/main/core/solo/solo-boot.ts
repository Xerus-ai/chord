import { stopLaneRuns } from '@main/core/lane-runs/lane-run-registry';
import { repoIsOnDisk } from '@main/core/work-items/repo-on-disk';
import { findWorktreeRow } from '@main/core/worktrees/worktree-lookup';
import { db } from '@main/db/client';
import { repos } from '@main/db/schema-work-items';
import { log } from '@main/lib/logger';
import { releaseSoloHost } from './release-solo-host';
import { announceSlot, ensureSlot, findSlot, listSlots, runInSlot } from './solo-slots';
import { readSoloState, recoverSoloOnBoot } from './solo-state';

/**
 * On boot, every repository whose root still holds a Solo record from a
 * previous run (plan §"Decisions for Phase 4", Solo host): an unchanged root
 * is released; a changed one stays held and its slot shows it as
 * interrupted, with the files, for the user to Restore. Per-repository
 * isolation follows boot acquisition (`acquireActiveWorktreeWorkspaces`): one
 * repository that cannot be read is logged and the others still settle.
 */
export async function recoverSoloSlotsOnBoot(): Promise<void> {
  for (const repo of db.select().from(repos).all()) {
    try {
      if (findSlot(repo.id)?.holder) continue;
      if (!(await repoIsOnDisk(repo.path))) continue;
      const state = await readSoloState(repo.path);
      if (state.status === 'none') continue;
      const recovery = await recoverSoloOnBoot(repo.path);
      if (recovery === 'none') continue;
      if (recovery === 'released') {
        log.info('[solo] released a Solo the previous run left', {
          repoId: repo.id,
          laneId: state.record.laneId,
        });
        continue;
      }
      const { laneId } = state.record;
      await runInSlot(repo.id, async () => {
        const slot = ensureSlot(repo.id, repo.path);
        slot.interrupted = {
          laneId,
          branch: findWorktreeRow(laneId)?.branchName ?? null,
          files: recovery.interrupted.files,
        };
        announceSlot(slot);
      });
    } catch (error) {
      log.error('[solo] could not settle a Solo the previous run left; continuing', {
        repoId: repo.id,
        path: repo.path,
        error: String(error),
      });
    }
  }
}

export function hasSoloHolds(): boolean {
  return listSlots().some((slot) => slot.holder !== null);
}

/**
 * App quit: each holder's runs stop (Ctrl+C first, as Stop does, so an
 * attached `docker compose up` stops its containers) and an unchanged root
 * is released, so the user's checkout is not left on a lane's detached HEAD
 * while the app is closed. A root changed during Solo stays held — boot shows
 * it as interrupted. The queue does not survive. Never rejects.
 */
export async function settleSoloOnQuit(): Promise<void> {
  for (const slot of listSlots().filter((candidate) => candidate.holder !== null)) {
    await runInSlot(slot.repoId, async () => {
      slot.queue = [];
      const laneId = slot.holder?.laneId;
      if (laneId === undefined) return;
      await stopLaneRuns(laneId);
      const released = await releaseSoloHost({
        rootPath: slot.rootPath,
        discardRootChanges: false,
      });
      if (released.success || released.error.type === 'solo_not_held') {
        slot.holder = null;
        if (released.success && released.data.leftovers) {
          log.info('[solo] moved run output out of the root at quit', released.data.leftovers);
        }
      } else {
        log.info('[solo] left the root held at quit; boot will show it', {
          repoId: slot.repoId,
          error: released.error,
        });
      }
      announceSlot(slot);
    }).catch((error: unknown) => {
      log.error('[solo] could not settle a Solo at quit', {
        repoId: slot.repoId,
        error: String(error),
      });
    });
  }
}
