import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserWindow, dialog, shell } from 'electron';
import { createRPCController } from '@shared/ipc/rpc';
import { err, ok } from '@shared/result';
import { resolveWorkItemCheckout } from '@main/core/work-items/work-item-checkout';
import { ArtifactFileMissingError } from './cloud-artifact-file';
import { loadCloudArtifactFile, prepareCloudArtifactFile } from './prepare-cloud-artifact-file';
import {
  loadLocalArtifactFile,
  prepareLocalArtifactFile,
  type LoadedArtifactFile,
} from './prepare-local-artifact-file';
import { loadRepoFileAt } from './prepare-repo-file';
import { prepareRepoFileAt } from './prepare-repo-file-view';

/**
 * Which copy of a file an action works on — the author's, a repo file, or the
 * cloud's (a pdf or pptx; an image or docx is its frame).
 */
type FileTarget =
  | { source: 'local'; artifactId: string; versionId?: string }
  | { source: 'repo'; workItemId: string; filePath: string; worktreeId?: string }
  | { source: 'cloud'; workItemId: string; artifactId: string; name: string; versionId?: string };

/** A repo file's checkout; the repo target names a work item and worktree, not an artifact. */
async function repoCheckout(target: { workItemId: string; worktreeId?: string }): Promise<string> {
  const checkout = await resolveWorkItemCheckout(target.workItemId, target.worktreeId);
  if (!checkout.success)
    throw new Error(`No checkout for ${target.workItemId}: ${checkout.error.type}`);
  return checkout.data;
}

async function loadFile(target: FileTarget): Promise<LoadedArtifactFile> {
  if (target.source === 'repo') return loadRepoFileAt(await repoCheckout(target), target.filePath);
  if (target.source === 'local') return loadLocalArtifactFile(target);
  return loadCloudArtifactFile(target);
}

function tempKeyFor(target: FileTarget): string {
  if (target.source === 'repo') return `repo-${target.workItemId}`;
  return target.artifactId;
}

/** A file with no shared copy yet (`no_file`) is typed; anything else propagates. */
async function withNoFile<T>(run: () => Promise<T>) {
  try {
    return ok(await run());
  } catch (error) {
    if (error instanceof ArtifactFileMissingError) {
      return err({ type: 'no_file' as const, message: error.message });
    }
    throw error;
  }
}

/**
 * Binary artifacts (design 2026-09-24 §10 "Desktop"): prepare one to show, open
 * it in the system's default app, or save a copy. The author's "Open" opens
 * the file itself; a stored version or a teammate's copy is written to a
 * per-version temp directory first.
 */
export const artifactFilesController = createRPCController({
  prepare: (target: FileTarget) =>
    withNoFile(async () =>
      target.source === 'repo'
        ? prepareRepoFileAt({
            workItemId: target.workItemId,
            checkoutPath: await repoCheckout(target),
            filePath: target.filePath,
          })
        : target.source === 'local'
          ? prepareLocalArtifactFile(target)
          : prepareCloudArtifactFile(target)
    ),

  open: (target: FileTarget) =>
    withNoFile(async () => {
      const file = await loadFile(target);
      if (file.diskPath) {
        const failure = await shell.openPath(file.diskPath);
        if (failure) throw new Error(`Opening ${file.fileName} failed: ${failure}`);
        return { path: file.diskPath };
      }
      const dir = join(
        tmpdir(),
        'chord-files',
        tempKeyFor(target),
        file.versionId ?? `copy-${Date.now()}`
      );
      mkdirSync(dir, { recursive: true });
      const path = join(dir, file.fileName);
      writeFileSync(path, file.bytes);
      const failure = await shell.openPath(path);
      if (failure) throw new Error(`Opening ${file.fileName} failed: ${failure}`);
      return { path };
    }),

  saveCopy: (target: FileTarget) =>
    withNoFile(async () => {
      const file = await loadFile(target);
      const window = BrowserWindow.getFocusedWindow();
      const options = { defaultPath: file.fileName };
      const choice = window
        ? await dialog.showSaveDialog(window, options)
        : await dialog.showSaveDialog(options);
      if (choice.canceled || !choice.filePath) return { path: null };
      writeFileSync(choice.filePath, file.bytes);
      return { path: choice.filePath };
    }),
});
