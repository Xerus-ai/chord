import { watch, type FSWatcher } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { eq } from 'drizzle-orm';
import { artifactContentUpdateChannel } from '@shared/events/artifactEvents';
import { db } from '@main/db/client';
import { artifacts } from '@main/db/schema-artifacts';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';

const DEBOUNCE_MS = 300;
const pendingPushes = new Map<string, ReturnType<typeof setTimeout>>();
/** One watcher per artifact, shared by every tab holding it (S6). */
const activeWatchers = new Map<string, { watcher: FSWatcher; holders: number }>();

export function pushArtifactContentToRenderer(
  workItemId: string,
  artifactId: string,
  filePath: string
): void {
  const existing = pendingPushes.get(artifactId);
  if (existing) clearTimeout(existing);

  pendingPushes.set(
    artifactId,
    setTimeout(() => {
      pendingPushes.delete(artifactId);
      void doPush(workItemId, artifactId, filePath);
    }, DEBOUNCE_MS)
  );
}

/**
 * Follows an artifact's file on disk while a tab holds it, so a write made
 * outside Chord (an editor, a checkout) reaches the tab like an agent write
 * does. Nothing is reported at the start: whoever opens the file reads it
 * itself, and a report of unchanged content would reload a page for nothing.
 * Each call is one holder; the watch ends when the last holder lets go.
 *
 * The directory is watched, not the file: an editor that saves by writing a
 * temporary file and renaming it over this one replaces the file, which ends
 * a watch on the file itself and arrives as a `rename`, not a `change`.
 * Every event naming this file is reported, like watch-artifact-sources.ts.
 */
export function watchArtifactFile(workItemId: string, artifactId: string, filePath: string): void {
  const active = activeWatchers.get(artifactId);
  if (active) {
    active.holders += 1;
    return;
  }

  try {
    const fileName = basename(filePath);
    const watcher = watch(dirname(filePath), { persistent: false }, (_eventType, changed) => {
      if (changed?.toString() === fileName) {
        pushArtifactContentToRenderer(workItemId, artifactId, filePath);
      }
    });

    watcher.on('error', (e) => {
      log.warn('push-to-yjs: file watch failed', { filePath, error: String(e) });
      stopWatchingArtifactFile(artifactId);
    });

    activeWatchers.set(artifactId, { watcher, holders: 1 });
  } catch (e) {
    log.warn('push-to-yjs: failed to watch file', { filePath, error: String(e) });
  }
}

/** Ends the watch whoever holds it: the artifact is gone, or the watch failed. */
export function stopWatchingArtifactFile(artifactId: string): void {
  activeWatchers.get(artifactId)?.watcher.close();
  activeWatchers.delete(artifactId);
}

/** Releases one holder; the last one stops the watch. */
export function unwatchArtifactFile(artifactId: string): void {
  const active = activeWatchers.get(artifactId);
  if (!active) return;
  active.holders -= 1;
  if (active.holders <= 0) stopWatchingArtifactFile(artifactId);
}

async function doPush(workItemId: string, artifactId: string, filePath: string): Promise<void> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch (e) {
    log.warn('push-to-yjs: failed to read file', { filePath, error: String(e) });
    return;
  }

  if (!content.trim()) return;

  // Snapshot the row so the artifact survives its file: a deleted, moved, or
  // never-synced file falls back to this copy instead of a not_found error
  // (artifacts/controller.ts readFileContent).
  try {
    db.update(artifacts)
      .set({ content, updatedAt: Math.floor(Date.now() / 1000) })
      .where(eq(artifacts.id, artifactId))
      .run();
  } catch (e) {
    log.warn('push-to-yjs: failed to snapshot artifact content', {
      artifactId,
      error: String(e),
    });
  }

  events.emit(artifactContentUpdateChannel, {
    workItemId,
    artifactId,
    filePath,
    content,
  });
}
