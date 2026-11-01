import { existsSync, watch, type FSWatcher } from 'node:fs';
import { dirname, join } from 'node:path';
import { artifactSourceDriftChannel } from '@shared/events/artifactEvents';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { listWorkItemSourceDrift, listWorkItemSourcePaths } from './artifact-sources';

/**
 * The drift half of the artifact file watcher (`push-to-yjs.ts` watches an
 * open artifact's own file; this watches the files artifacts were written
 * from). A work item is watched while some view shows its artifacts — views
 * hold a reference each. The watchers sit on the sources' directories, not on
 * the files: editors and agents save by writing a temp file and renaming it
 * over the original, which ends a watcher bound to the old file.
 */

const DEBOUNCE_MS = 300;

interface WatchedWorkItem {
  refs: number;
  /** Source paths, keyed for comparison with what the directory watcher reports. */
  sourceKeys: Set<string>;
  directories: Map<string, FSWatcher>;
  pendingReport: ReturnType<typeof setTimeout> | null;
}

const watchedWorkItems = new Map<string, WatchedWorkItem>();

/** Windows paths compare case-insensitively; the watcher reports on-disk case. */
function toPathKey(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase() : path;
}

export function watchArtifactSources(workItemId: string): void {
  const entry = watchedWorkItems.get(workItemId) ?? {
    refs: 0,
    sourceKeys: new Set<string>(),
    directories: new Map<string, FSWatcher>(),
    pendingReport: null,
  };
  entry.refs += 1;
  watchedWorkItems.set(workItemId, entry);
  aimWatchers(workItemId, entry);
}

export function unwatchArtifactSources(workItemId: string): void {
  const entry = watchedWorkItems.get(workItemId);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs > 0) return;
  for (const watcher of entry.directories.values()) watcher.close();
  if (entry.pendingReport) clearTimeout(entry.pendingReport);
  watchedWorkItems.delete(workItemId);
}

/**
 * Recomputes the work item's drift and sends it to the renderer — at turn end,
 * after a publish or review, and when a watched source changes. A watched work
 * item's watchers are re-aimed first, since a publish can change the list.
 */
export function reportArtifactSourceDrift(workItemId: string): void {
  const entry = watchedWorkItems.get(workItemId);
  if (entry) aimWatchers(workItemId, entry);
  events.emit(artifactSourceDriftChannel, {
    workItemId,
    drift: listWorkItemSourceDrift(workItemId),
  });
}

function scheduleReport(workItemId: string, entry: WatchedWorkItem): void {
  if (entry.pendingReport) clearTimeout(entry.pendingReport);
  entry.pendingReport = setTimeout(() => {
    entry.pendingReport = null;
    if (watchedWorkItems.get(workItemId) === entry) reportArtifactSourceDrift(workItemId);
  }, DEBOUNCE_MS);
}

function aimWatchers(workItemId: string, entry: WatchedWorkItem): void {
  const paths = listWorkItemSourcePaths(workItemId);
  entry.sourceKeys = new Set(paths.map(toPathKey));
  const directories = new Set(paths.map((path) => dirname(path)));

  for (const [directory, watcher] of entry.directories) {
    if (directories.has(directory)) continue;
    watcher.close();
    entry.directories.delete(directory);
  }
  for (const directory of directories) {
    // A directory that is gone has nothing left to change: its sources
    // already read as deleted. It is watched again once a publish re-lists it.
    if (entry.directories.has(directory) || !existsSync(directory)) continue;
    const watcher = watch(directory, { persistent: false }, (_eventType, fileName) => {
      if (!fileName || !entry.sourceKeys.has(toPathKey(join(directory, fileName.toString())))) {
        return;
      }
      scheduleReport(workItemId, entry);
    });
    watcher.on('error', (error) => {
      log.warn('watch-artifact-sources: directory watcher failed', {
        directory,
        error: String(error),
      });
      watcher.close();
      entry.directories.delete(directory);
      scheduleReport(workItemId, entry);
    });
    entry.directories.set(directory, watcher);
  }
}
