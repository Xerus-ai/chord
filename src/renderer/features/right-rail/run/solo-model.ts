import type { SoloActionError, SoloView } from '@shared/solo';

/**
 * What the Run tab says about a repository's Solo slot from one lane's side
 * (plan §"Decisions for Phase 4", Slot + queue and Run tab): its one status
 * line, its one Solo action, whether this lane holds the root (its rows then
 * act on the Solo runs, with Sync and Release), and the changed files of an
 * interrupted Solo.
 */

export type SoloActionKind = 'solo' | 'queue' | 'leave' | 'restore';

export interface SoloTabModel {
  status: string | null;
  action: { kind: SoloActionKind; label: string } | null;
  holding: boolean;
  files: string[];
}

export const SOLO_COMPOSE_HELP =
  'A run script that starts Docker Compose should use `docker compose up --remove-orphans`: ' +
  'every branch then runs as the same stack, and services a branch drops are stopped.';

export function describeSoloTab(solo: SoloView, laneId: string): SoloTabModel {
  const idle = { holding: false, files: [] };
  if (solo.interrupted) {
    return {
      status: `Solo of ${solo.interrupted.branch ?? 'a deleted branch'} was interrupted`,
      action: { kind: 'restore', label: 'Restore' },
      holding: false,
      files: solo.interrupted.files,
    };
  }
  if (solo.holder?.laneId === laneId) {
    return { status: `Soloing in ${solo.rootPath}`, action: null, holding: true, files: [] };
  }
  const index = solo.queue.findIndex((entry) => entry.laneId === laneId);
  if (index >= 0) {
    return {
      status: `Queued · ${index + 1} ahead`,
      action: { kind: 'leave', label: 'Leave queue' },
      ...idle,
    };
  }
  if (solo.holder) {
    // Named by its work item first, as the sidebar names it (devstation-5b3.6).
    const { workItemName, branch } = solo.holder;
    return {
      status: `${workItemName} is soloing${branch ? ` on ${branch}` : ''}`,
      action: { kind: 'queue', label: `Queue (${1 + solo.queue.length} ahead)` },
      ...idle,
    };
  }
  return { status: null, action: { kind: 'solo', label: 'Solo this branch' }, ...idle };
}

export interface SoloErrorModel {
  message: string;
  files: string[];
  /** A root changed during Solo: "Discard and release" is the explicit second step. */
  offerDiscard: boolean;
}

/** A Solo refusal, in the words the Run tab shows, with the files it is about. */
export function describeSoloError(error: SoloActionError, rootPath: string): SoloErrorModel {
  const plain = (message: string): SoloErrorModel => ({ message, files: [], offerDiscard: false });
  switch (error.type) {
    case 'root_dirty':
      return {
        message: `Commit or stash these in ${rootPath} first`,
        files: error.files,
        offerDiscard: false,
      };
    case 'root_changed':
      return {
        message: `These changed in ${rootPath} during Solo. Releasing puts the root back, dropping them.`,
        files: error.files,
        offerDiscard: true,
      };
    case 'root_busy':
      return plain(`${rootPath} is in the middle of a ${error.operation}. Finish it there first.`);
    case 'solo_held':
      return plain(`${rootPath} already holds another branch's Solo, from outside this session.`);
    case 'solo_interrupted':
      return plain('An interrupted Solo still holds the root. Restore it first.');
    case 'not_solo_mode':
      return plain("This repository's run mode is no longer Solo.");
    case 'solo_not_held':
      return plain('This branch is not soloing.');
    case 'not_queued':
      return plain('This branch is not in the queue.');
    case 'declined':
      return plain("You chose Don't run, so nothing changed. Solo again to review the scripts.");
    case 'setup_running':
      return plain('Setup is still running. Solo this branch once it finishes.');
    case 'no_script':
      return plain('The repository has no run scripts.');
    case 'checkout_missing':
      return plain("This lane's checkout is not on this machine.");
    case 'not_found':
      return plain('This lane no longer exists.');
    case 'no_repo':
      return plain('This lane belongs to no repository.');
    case 'config_invalid':
      return plain(error.message);
  }
}
