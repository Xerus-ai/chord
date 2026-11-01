import type { FileWatchEvent } from '@shared/fs';

/**
 * Whether a batch from the worktree watcher changes this repo file: written,
 * created, deleted, or renamed onto or away from it (an editor that saves by
 * rename). Watcher paths are relative to the worktree and POSIX-style.
 */
export function touchesRepoFile(events: FileWatchEvent[], filePath: string): boolean {
  const target = filePath.replace(/\\/g, '/');
  return events.some((event) => event.path === target || event.oldPath === target);
}
