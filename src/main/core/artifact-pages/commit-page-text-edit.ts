import { readFile, writeFile } from 'node:fs/promises';
import type { ArtifactType } from '@shared/stream-items';
import { getArtifact } from '@main/core/artifacts/getArtifact';
import { pushArtifactContentToRenderer } from '@main/core/artifacts/push-to-yjs';
import {
  buildArtifactVersionView,
  commitArtifactVersion,
  PageViewBuildError,
  type VersionedArtifact,
} from '@main/core/artifacts/record-artifact-version';
import { resolveArtifactAuthorName } from '@main/core/artifacts/save-artifact-version';
import { updateConfluenceAfterChange } from '@main/core/confluence/auto-update-confluence';
import { PageTextEditRejectedError, replaceChordElementText } from './page-element-ids';
import { loadParse5 } from './page-source-elements';

export interface PageTextEdit {
  artifactId: string;
  chordId: string;
  originalText: string;
  text: string;
}

export type PageTextEditResult =
  | { changed: false }
  | { changed: true; content: string; versionNumber: number };

/**
 * One edit at a time per artifact: two quick commits on the same file would
 * otherwise both read the old source and the second write would drop the
 * first. Concurrency between users stays per-element last-write-wins (plan
 * P1b step 2) — this only stops one process from racing itself.
 */
const queues = new Map<string, Promise<unknown>>();

function serialize<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.then(run, run);
  const settled = next.then(
    () => undefined,
    () => undefined
  );
  queues.set(key, settled);
  void settled.then(() => {
    if (queues.get(key) === settled) queues.delete(key);
  });
  return next;
}

/**
 * Writes an in-place text edit into a web page's source file, saves the result
 * as a version queued for upload with its view (design 2026-09-24 §9), and
 * tells every open view the file changed. The element is
 * found by its stamped id in the file as it is now, so an edit lands on that
 * element only, whatever else moved. Refusals are `PageTextEditRejectedError`
 * with a message meant for the user.
 */
export function commitPageTextEdit(edit: PageTextEdit): Promise<PageTextEditResult> {
  return serialize(edit.artifactId, async () => {
    const artifact = await getArtifact(edit.artifactId);
    if (!artifact) throw new PageTextEditRejectedError(`Artifact not found: ${edit.artifactId}`);
    if (artifact.type !== 'web' || !artifact.filePath) {
      throw new PageTextEditRejectedError('Only web pages can be edited in place.');
    }
    // Checked before the file is touched: an edit is never written without
    // the version that records who made it.
    const authorName = await resolveArtifactAuthorName();
    if (!authorName) {
      throw new PageTextEditRejectedError(
        'Sign in to Chord — edits are saved as versions attributed to your account.'
      );
    }

    const source = await readFile(artifact.filePath, 'utf-8');
    const result = replaceChordElementText(await loadParse5(), source, edit);
    if (!result.changed) return { changed: false };

    const versioned: VersionedArtifact = {
      id: artifact.id,
      workItemId: artifact.workItemId,
      filePath: artifact.filePath,
      type: artifact.type as ArtifactType,
    };
    // Built before the file is touched, for the same reason as the identity
    // check: an edit is never written without its version.
    let view;
    try {
      view = await buildArtifactVersionView(versioned, result.html);
    } catch (error) {
      if (error instanceof PageViewBuildError) {
        throw new PageTextEditRejectedError(
          `The edit was not saved: the page's shared view could not be built. ${error.message}`
        );
      }
      throw error;
    }

    await writeFile(artifact.filePath, result.html, 'utf-8');
    // No base check: the edit patched one element of the file as it is now.
    const saved = commitArtifactVersion({
      artifact: versioned,
      content: result.html,
      trigger: 'manual',
      label: 'Edited in place',
      authorName,
      baseVersion: null,
      view,
    });
    if (saved.status !== 'saved')
      throw new Error('An unconditional version save reported a conflict');
    pushArtifactContentToRenderer(artifact.workItemId, artifact.id, artifact.filePath);
    updateConfluenceAfterChange({ artifactId: artifact.id, savedContent: result.html });
    return { changed: true, content: result.html, versionNumber: saved.version.versionNumber };
  });
}
