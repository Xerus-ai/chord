import { EventEmitter } from 'node:events';
import type { HostPreviewEvent } from '@shared/hostPreview';

/**
 * `dev-server-watcher.ts` already emits `HostPreviewEvent`s on the shared
 * `hostPreviewEventChannel`, but that channel's main-process adapter
 * (`@main/lib/events`) only bridges main → renderer over `webContents.send`;
 * `ipcMain.on` on the same channel only receives messages the renderer sends
 * back. There is no loop-back path for main-process code to observe its own
 * emit, so a same-process subscriber needs a real in-process bus. This one
 * is that bus — `dev-server-watcher.ts` calls `recordHostPreviewEvent`
 * alongside its existing `events.emit`, and this module is the only reader.
 *
 * `event.taskId` is a worktree id: worktree terminals are created with
 * `scopeId: row.id` (see `core/worktrees/workspace-bridge.ts`), which is the
 * `work_item_worktrees.id` the terminal's dev server runs in — not the work
 * item id.
 */
const bus = new EventEmitter();
bus.setMaxListeners(0);

/** Latest known dev server URL per worktree id. Cleared on 'exit'. */
const urlByWorktreeId = new Map<string, string>();

export function recordHostPreviewEvent(event: HostPreviewEvent): void {
  if (event.type === 'url' && event.url) {
    urlByWorktreeId.set(event.taskId, event.url);
    bus.emit('change');
  } else if (event.type === 'exit') {
    if (urlByWorktreeId.delete(event.taskId)) bus.emit('change');
  }
  // 'setup' carries lifecycle-script progress, not a URL — nothing to record.
}

/** The dev server URL for a worktree, or null if none has been detected. */
export function getDevServerUrl(worktreeId: string): string | null {
  return urlByWorktreeId.get(worktreeId) ?? null;
}
