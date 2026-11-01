import type { ArtifactFileMimeType } from '@shared/artifact-file-types';
import { renderClassForArtifactType } from '@shared/artifact-render-class';
import type { ArtifactType } from '@shared/stream-items';
import { resolveArtifactRuntimeDir } from '@main/core/artifact-pages/artifact-runtime-dir';
import {
  buildPageSnapshot,
  type PageSnapshot,
} from '@main/core/artifact-pages/build-page-snapshot';
import { describeFilePageSource } from '@main/core/artifact-pages/page-source-registry';
import { syncQueueService } from '@main/core/work-items/sync-queue-service';
import type { ArtifactVersionTrigger } from './artifact-utils';
import { getArtifact } from './getArtifact';
import { insertArtifactVersion, type ArtifactVersionRow } from './save-artifact-version';

/**
 * Every local version of a page is uploaded with its self-contained view, so
 * teammates and public links can see it with the author's machine off (design
 * 2026-09-24 §9 "Upload"). The view is built before anything is stored: a
 * page whose view does not build is not saved, and the caller is told why.
 *
 * Files (§10): a version's `content` is the file's bytes as base64, uploaded
 * with its MIME type and — for an image or docx — its view. Files are only
 * versioned by publishing (publish-artifact-file.ts), never by a manual save.
 *
 * Documents: a manual save is uploaded without content or view — it is made
 * from an open editor, so the server snapshots its live Yjs state. An agent
 * milestone stays local: the live document holds the agent's content only
 * once the author's editor applies it (use-agent-content-push.ts), and the
 * renderer records the cloud milestone then. Automatic snapshots are never
 * uploaded; the server keeps its own.
 */

/** The page's view did not build; the message is the compiler's or names the missing asset. */
export class PageViewBuildError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PageViewBuildError';
  }
}

export interface VersionedArtifact {
  id: string;
  workItemId: string;
  filePath: string;
  type: ArtifactType;
}

/** The view of `content` as a version of `artifact`; null for anything that is not a page. */
export async function buildArtifactVersionView(
  artifact: VersionedArtifact,
  content: string
): Promise<PageSnapshot | null> {
  if (renderClassForArtifactType(artifact.type) !== 'page') return null;
  const runtimeDir = resolveArtifactRuntimeDir();
  const source = describeFilePageSource({
    pageId: artifact.id,
    type: artifact.type,
    filePath: artifact.filePath,
    workItemId: artifact.workItemId,
    inlineSource: content,
  });
  try {
    return await buildPageSnapshot({ source, runtimeDir });
  } catch (error) {
    throw new PageViewBuildError(error instanceof Error ? error.message : String(error), {
      cause: error,
    });
  }
}

/** What a file version uploads beside its bytes. */
export interface FileVersionUpload {
  mimeType: ArtifactFileMimeType;
  viewHtml: string | null;
}

function enqueueVersionUpload(
  artifact: VersionedArtifact,
  version: ArtifactVersionRow,
  view: PageSnapshot | null,
  file: FileVersionUpload | null
): void {
  const trigger = version.trigger as ArtifactVersionTrigger;
  if (trigger === 'auto') return;
  const base = {
    artifact_id: artifact.id,
    work_item_id: artifact.workItemId,
    client_version_id: version.id,
    trigger,
    label: version.label,
  };
  const renderClass = renderClassForArtifactType(artifact.type);
  if (renderClass === 'page') {
    if (!view) throw new Error(`Page version ${version.id} has no view to upload`);
    syncQueueService.enqueueArtifactVersionUpload({
      ...base,
      content: version.content,
      view_html: view.html,
    });
    return;
  }
  if (renderClass === 'file') {
    if (!file) throw new Error(`File version ${version.id} has no MIME type to upload`);
    syncQueueService.enqueueArtifactVersionUpload({
      ...base,
      file_base64: version.content,
      mime_type: file.mimeType,
      ...(file.viewHtml === null ? {} : { view_html: file.viewHtml }),
    });
    return;
  }
  if (renderClass === 'document' && trigger === 'manual') {
    syncQueueService.enqueueArtifactVersionUpload(base);
  }
}

export type RecordArtifactVersionResult =
  | { status: 'saved'; version: ArtifactVersionRow; warnings: string[] }
  | { status: 'conflict'; latestVersion: number };

/**
 * Stores a version whose view (if it is a page) is already built, and queues
 * its upload. Synchronous, so a caller can decide and write in one tick.
 */
export function commitArtifactVersion(args: {
  artifact: VersionedArtifact;
  content: string;
  trigger: ArtifactVersionTrigger;
  label?: string;
  authorName: string;
  baseVersion: number | null;
  view: PageSnapshot | null;
  /** A file version's MIME type and view; `content` is then the bytes as base64. */
  file?: FileVersionUpload;
}): RecordArtifactVersionResult {
  const result = insertArtifactVersion({
    artifactId: args.artifact.id,
    content: args.content,
    trigger: args.trigger,
    label: args.label,
    authorName: args.authorName,
    baseVersion: args.baseVersion,
  });
  if (result.status === 'conflict') return result;
  enqueueVersionUpload(args.artifact, result.version, args.view, args.file ?? null);
  return { status: 'saved', version: result.version, warnings: args.view?.warnings ?? [] };
}

/** Builds the view, stores the version and queues its upload. */
export async function recordArtifactVersion(args: {
  artifactId: string;
  content: string;
  trigger: ArtifactVersionTrigger;
  label?: string;
  authorName: string;
  baseVersion: number | null;
}): Promise<RecordArtifactVersionResult> {
  const row = await getArtifact(args.artifactId);
  if (!row) throw new Error(`Artifact not found: ${args.artifactId}`);
  const artifact: VersionedArtifact = {
    id: row.id,
    workItemId: row.workItemId,
    filePath: row.filePath,
    type: row.type as ArtifactType,
  };
  if (renderClassForArtifactType(artifact.type) === 'file') {
    throw new Error(`${row.filePath} is a file: it is versioned by publishing it, not saved`);
  }
  const view = await buildArtifactVersionView(artifact, args.content);
  return commitArtifactVersion({ ...args, artifact, view });
}
