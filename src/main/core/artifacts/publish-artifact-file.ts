import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { renderClassForArtifactType } from '@shared/artifact-render-class';
import type { ArtifactType } from '@shared/stream-items';
import { buildFileView } from '@main/core/artifact-files/build-file-view';
import { readArtifactFileBytes } from '@main/core/artifact-files/read-artifact-file-bytes';
import { resolveArtifactRuntimeDir } from '@main/core/artifact-pages/artifact-runtime-dir';
import { stampPublishedPage } from '@main/core/artifact-pages/stamp-published-page';
import { db } from '@main/db/client';
import { artifacts, type ArtifactRow } from '@main/db/schema-artifacts';
import { extractFileName } from './artifact-utils';
import { createArtifact } from './createArtifact';
import { findArtifactByPath } from './find-artifact-by-path';
import {
  buildArtifactVersionView,
  commitArtifactVersion,
  type FileVersionUpload,
  type VersionedArtifact,
} from './record-artifact-version';
import { readLatestArtifactVersionContent } from './save-artifact-version';

export interface PublishedArtifactFile {
  artifact: ArtifactRow;
  created: boolean;
  /** The version this publish saved. */
  versionNumber: number;
  /** Remote references the page's shared view blocks. */
  warnings: string[];
}

interface PublishedContent {
  /** The version's content: text, or a file's bytes as base64. */
  content: string;
  view: Awaited<ReturnType<typeof buildArtifactVersionView>>;
  file?: FileVersionUpload;
}

/**
 * What a publish saves as the version. A file (§10) is its bytes — capped at
 * 8 MiB, the publish fails above that — with its MIME type and, for an image
 * or docx, the view it is shown through. Text is itself, plus a page's view.
 */
async function readPublishedContent(versioned: VersionedArtifact): Promise<PublishedContent> {
  if (renderClassForArtifactType(versioned.type) === 'file') {
    const { bytes, mimeType } = readArtifactFileBytes(versioned.filePath);
    const viewHtml = await buildFileView({
      fileName: extractFileName(versioned.filePath),
      mimeType,
      bytes,
      runtimeDir: resolveArtifactRuntimeDir(),
    });
    return { content: bytes.toString('base64'), view: null, file: { mimeType, viewHtml } };
  }
  const content = readFileSync(versioned.filePath, 'utf-8');
  return { content, view: await buildArtifactVersionView(versioned, content) };
}

/**
 * Publishing a file — `publish_artifact` and "Add to artifacts" alike — is an
 * agent milestone (design 2026-09-24 §9 decision 4): the artifact is created
 * or updated and the file as published is saved as its next version,
 * attributed to `authorName` and queued for upload. A page's or file's view is
 * built first; if it does not build — or a file is over 8 MiB — nothing is
 * created or saved and the reason is thrown (`PageViewBuildError`,
 * `ArtifactFileTooLargeError`, `FileViewTooLargeError`).
 *
 * Identity is the path: `(work_item_id, file_path)` is unique, so publishing a
 * file that is already an artifact updates it (`created: false`).
 */
export async function publishArtifactFile(args: {
  workItemId: string;
  filePath: string;
  type: ArtifactType;
  /** The title to set; an existing artifact keeps its own when omitted. */
  title?: string;
  authorName: string;
  /** Initial `artifacts.content` of a new row. */
  initialContent?: string;
}): Promise<PublishedArtifactFile> {
  const newId = randomUUID();
  const existingId = findArtifactByPath(args.workItemId, args.filePath)?.id;
  // A web page's elements get their stable ids on every publish, so a
  // republish re-stamps whatever the agent added since — keeping ids where the
  // previously published version had them.
  await stampPublishedPage(
    args.filePath,
    args.type,
    existingId === undefined ? null : readLatestArtifactVersionContent(existingId)
  );
  const versioned = {
    id: existingId ?? newId,
    workItemId: args.workItemId,
    filePath: args.filePath,
    type: args.type,
  };
  const published = await readPublishedContent(versioned);

  // No await from here on: the existence check, the insert and the version
  // run in one tick, so two publishes of one file cannot both create it.
  const { artifact, created } = upsertArtifact({ ...args, newId });

  const saved = commitArtifactVersion({
    artifact: { ...versioned, id: artifact.id },
    content: published.content,
    trigger: 'agent_milestone',
    authorName: args.authorName,
    baseVersion: null,
    view: published.view,
    file: published.file,
  });
  if (saved.status !== 'saved') {
    throw new Error('An unconditional version save reported a conflict');
  }
  return {
    artifact,
    created,
    versionNumber: saved.version.versionNumber,
    warnings: saved.warnings,
  };
}

function upsertArtifact(args: {
  workItemId: string;
  filePath: string;
  type: ArtifactType;
  title?: string;
  initialContent?: string;
  newId: string;
}): { artifact: ArtifactRow; created: boolean } {
  const existing = findArtifactByPath(args.workItemId, args.filePath);
  if (existing) {
    const name = args.title ?? existing.name;
    db.update(artifacts)
      .set({ name, updatedAt: Math.floor(Date.now() / 1000) })
      .where(eq(artifacts.id, existing.id))
      .run();
    return { artifact: { ...existing, name }, created: false };
  }

  const { artifact } = createArtifact({
    id: args.newId,
    workItemId: args.workItemId,
    filePath: args.filePath,
    name: args.title ?? extractFileName(args.filePath),
    type: args.type,
    content: args.initialContent,
  });
  if (!artifact) throw new Error(`Creating the artifact for ${args.filePath} stored no row`);
  return { artifact, created: true };
}
