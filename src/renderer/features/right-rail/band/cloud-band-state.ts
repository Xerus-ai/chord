import type { BandState } from './band-state';

/** What the band reads of the owner's pushed snapshot. */
export interface CloudBandSnapshot {
  files: readonly unknown[];
  branch_name: string | null;
}

/** What the band reads of the item: whether it has a repository at all. */
export interface CloudBandItem {
  repo_name: string | null;
  repo_remote_url: string | null;
}

/**
 * A teammate's band line (step 4, S7): the owner's snapshot says how many
 * files changed, or which branch is clean. Never-synced is not the same as a
 * clean tree, so it says nothing has arrived rather than "no changes". An
 * item with no repository has no git state to arrive, ever, so it says that
 * instead of calling it unsynced (devstation-c4t).
 */
export function cloudBandState(
  snapshot: CloudBandSnapshot | null | undefined,
  item: CloudBandItem
): BandState {
  const changed = snapshot?.files.length ?? 0;
  if (changed > 0) {
    return {
      glyph: 'changes',
      signal: 'neutral',
      text: `${changed} changed file${changed === 1 ? '' : 's'}`,
      short: `${changed}`,
    };
  }
  const branch = snapshot?.branch_name ?? null;
  if (branch) return { glyph: 'branch', signal: 'neutral', text: branch, short: branch };
  if (item.repo_name === null && item.repo_remote_url === null) {
    return { glyph: 'branch', signal: 'neutral', text: 'No repository', short: 'No repo' };
  }
  return { glyph: 'branch', signal: 'neutral', text: 'No changes shared yet', short: 'Not synced' };
}
