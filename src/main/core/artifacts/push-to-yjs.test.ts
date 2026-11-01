import { mkdtempSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactContentUpdate } from '@shared/events/artifactEvents';
import { removeDirSync } from '@main/lib/remove-dir-sync';

/**
 * A local page tab follows its file on disk (shared-items step 1, S6): an
 * edit made outside Chord reaches the page, its pins and "Element changed".
 * Real files and a real `fs.watch`; the main-process event bus needs an
 * Electron window, so what it would send is recorded instead.
 */
const emitted: ArtifactContentUpdate[] = [];
vi.mock('@main/lib/events', () => ({
  events: { emit: (_channel: unknown, data: ArtifactContentUpdate) => emitted.push(data) },
}));
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const { unwatchArtifactFile, watchArtifactFile } = await import('./push-to-yjs');

const WORK_ITEM_ID = 'w-watch';
const ARTIFACT_ID = 'a-watch';

let dir: string;
let file: string;

beforeEach(() => {
  emitted.length = 0;
  dir = mkdtempSync(join(tmpdir(), 'chord-watch-'));
  file = join(dir, 'page.html');
  writeFileSync(file, '<h1>First</h1>');
});

afterEach(() => {
  // Release every holder a test left, so no watcher outlives its directory.
  for (let i = 0; i < 3; i++) unwatchArtifactFile(ARTIFACT_ID);
  removeDirSync(dir);
});

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForEmit(count: number): Promise<void> {
  for (let waited = 0; waited < 3000 && emitted.length < count; waited += 50) await pause(50);
}

describe('watchArtifactFile', () => {
  it('reports nothing when it starts: whoever opens the file reads it itself', async () => {
    watchArtifactFile(WORK_ITEM_ID, ARTIFACT_ID, file);
    await pause(600);
    expect(emitted).toEqual([]);
  });

  it('reports a write to the file with its new content', async () => {
    watchArtifactFile(WORK_ITEM_ID, ARTIFACT_ID, file);
    writeFileSync(file, '<h1>Rewritten</h1>');
    await waitForEmit(1);
    expect(emitted).toEqual([
      {
        workItemId: WORK_ITEM_ID,
        artifactId: ARTIFACT_ID,
        filePath: file,
        content: '<h1>Rewritten</h1>',
      },
    ]);
  });

  it('reports a save that replaces the file by rename, and keeps following it', async () => {
    watchArtifactFile(WORK_ITEM_ID, ARTIFACT_ID, file);
    // How many editors save: write a temporary file, then rename it over the original.
    const temp = join(dir, 'page.html.tmp');
    writeFileSync(temp, '<h1>Saved by rename</h1>');
    renameSync(temp, file);
    await waitForEmit(1);
    expect(emitted.map((update) => update.content)).toEqual(['<h1>Saved by rename</h1>']);

    writeFileSync(file, '<h1>Written after</h1>');
    await waitForEmit(2);
    expect(emitted.map((update) => update.content)).toEqual([
      '<h1>Saved by rename</h1>',
      '<h1>Written after</h1>',
    ]);
  });

  it('ignores other files in the same directory', async () => {
    watchArtifactFile(WORK_ITEM_ID, ARTIFACT_ID, file);
    writeFileSync(join(dir, 'other.html'), '<h1>Not this one</h1>');
    await pause(800);
    expect(emitted).toEqual([]);
  });

  it('keeps watching while any holder remains, and stops when the last lets go', async () => {
    watchArtifactFile(WORK_ITEM_ID, ARTIFACT_ID, file);
    watchArtifactFile(WORK_ITEM_ID, ARTIFACT_ID, file);
    unwatchArtifactFile(ARTIFACT_ID);
    writeFileSync(file, '<h1>Still watched</h1>');
    await waitForEmit(1);
    expect(emitted.map((update) => update.content)).toEqual(['<h1>Still watched</h1>']);

    unwatchArtifactFile(ARTIFACT_ID);
    writeFileSync(file, '<h1>Nobody listening</h1>');
    await pause(800);
    expect(emitted.map((update) => update.content)).toEqual(['<h1>Still watched</h1>']);
  });
});
