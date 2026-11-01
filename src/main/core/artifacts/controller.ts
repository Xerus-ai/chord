import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { and, asc, desc, eq } from 'drizzle-orm';
import { createRPCController } from '@shared/ipc/rpc';
import { err, ok } from '@shared/result';
import type { ArtifactType } from '@shared/stream-items';
import { FileViewTooLargeError } from '@main/core/artifact-files/build-file-view';
import { ArtifactFileTooLargeError } from '@main/core/artifact-files/read-artifact-file-bytes';
import { updateConfluenceAfterChange } from '@main/core/confluence/auto-update-confluence';
import { findPublication } from '@main/core/confluence/publication-records';
import { likeContains } from '@main/core/utils/sql-like';
import { db } from '@main/db/client';
import { artifactComments, artifacts, artifactVersions } from '@main/db/schema-artifacts';
import { workItems } from '@main/db/schema-work-items';
import { log } from '@main/lib/logger';
import { resolveStoredArtifactPath } from './artifact-file-path';
import { listWorkItemSourceDrift, rebaselineArtifactSources } from './artifact-sources';
import {
  inferArtifactType,
  type ArtifactStatus,
  type ArtifactVersionTrigger,
} from './artifact-utils';
import { deleteArtifact } from './delete-artifact';
import { artifactOfDeviceComment, isArtifactInCloud } from './device-comments';
import { getArtifact } from './getArtifact';
import { listLocalRailSummary } from './list-local-rail-summary';
import { listArtifacts } from './listArtifacts';
import { publishArtifactFile } from './publish-artifact-file';
import { unwatchArtifactFile, watchArtifactFile } from './push-to-yjs';
import { PageViewBuildError, recordArtifactVersion } from './record-artifact-version';
import { restoreArtifactVersion } from './restore-artifact-version';
import { resolveArtifactAuthorName } from './save-artifact-version';
import { updateArtifactStatus } from './updateArtifactStatus';
import {
  reportArtifactSourceDrift,
  unwatchArtifactSources,
  watchArtifactSources,
} from './watch-artifact-sources';

const NO_IDENTITY = {
  type: 'no_identity' as const,
  message: 'Sign in to Chord — saved rows are attributed to your account.',
};

/**
 * A comment id that matches no row updates nothing; reporting that as success
 * let the renderer paint a resolved thread that never changed on disk.
 */
function viewBuildFailed(error: PageViewBuildError) {
  return err({
    type: 'view_build_failed' as const,
    message: `The page's shared view could not be built: ${error.message}`,
  });
}

/**
 * The device keeps an artifact's comments only until it reaches the cloud
 * (device-comments.ts). A comments card that still holds the device store
 * after that is told so, and re-resolves to the cloud (comment-store-moved.ts).
 */
const IN_CLOUD = {
  type: 'artifact_in_cloud' as const,
  message: "This artifact's comments are kept in the cloud now; sign in to see them.",
};

function setCommentResolved(commentId: string, resolved: 0 | 1) {
  const artifactId = artifactOfDeviceComment(commentId);
  if (artifactId !== null && isArtifactInCloud(artifactId)) return err(IN_CLOUD);
  const result = db
    .update(artifactComments)
    .set({ resolved })
    .where(eq(artifactComments.id, commentId))
    .run();
  if (result.changes === 0) return err({ type: 'not_found' as const });
  return ok({});
}

export const artifactsController = createRPCController({
  /**
   * "Add to artifacts" publishes the file exactly as publish_artifact does:
   * version 1 is saved as an agent milestone and queued for upload, a page
   * with its view (publish-artifact-file.ts).
   */
  create: async (args: {
    workItemId: string;
    filePath: string;
    name: string;
    type?: ArtifactType;
    content?: string;
  }) => {
    const authorName = await resolveArtifactAuthorName();
    if (!authorName) return err(NO_IDENTITY);
    try {
      const published = await publishArtifactFile({
        workItemId: args.workItemId,
        filePath: args.filePath,
        type: args.type ?? inferArtifactType(args.filePath),
        title: args.name,
        authorName,
        initialContent: args.content,
      });
      return ok({ artifact: published.artifact, warnings: published.warnings });
    } catch (error) {
      if (error instanceof PageViewBuildError) return viewBuildFailed(error);
      // A file over the 8 MiB cap, or a docx whose view is (design §10).
      if (error instanceof ArtifactFileTooLargeError || error instanceof FileViewTooLargeError) {
        return err({ type: 'file_too_large' as const, message: error.message });
      }
      throw error;
    }
  },

  get: async (id: string) => {
    const artifact = await getArtifact(id);
    if (!artifact) return err({ type: 'not_found' as const });
    return ok({ artifact });
  },

  listByWorkItem: async (workItemId: string) => {
    const rows = await listArtifacts(workItemId);
    return ok({ artifacts: rows });
  },

  /** The rail's local counts: open threads kept on this device and the latest version (S8). */
  listRailSummary: (workItemId: string) => ok({ artifacts: listLocalRailSummary(workItemId) }),

  searchAll: (args: { query: string; limit?: number }) => {
    const rows = db
      .select({
        id: artifacts.id,
        workItemId: artifacts.workItemId,
        name: artifacts.name,
        type: artifacts.type,
        status: artifacts.status,
        workItemName: workItems.name,
      })
      .from(artifacts)
      .leftJoin(workItems, eq(artifacts.workItemId, workItems.id))
      .where(likeContains(artifacts.name, args.query))
      .limit(args.limit ?? 10)
      .all();
    return ok({ artifacts: rows });
  },

  /** Deletes the artifact for everyone; the file stays on disk (delete-artifact.ts). */
  delete: (args: { id: string }) => deleteArtifact(args.id),

  /** Whether a Confluence page was published from it — the delete confirmation names it. */
  hasConfluencePage: (args: { id: string }) => ok({ published: findPublication(args.id) !== null }),

  updateStatus: async (args: { id: string; status: ArtifactStatus }) => {
    const artifact = await updateArtifactStatus(args.id, args.status);
    if (!artifact) return err({ type: 'not_found' as const });
    return ok({ artifact });
  },

  readFileContent: (args: { filePath: string; workItemId?: string }) => {
    const resolvedPath = resolveStoredArtifactPath(args.filePath, args.workItemId);

    try {
      const content = readFileSync(resolvedPath, 'utf-8');
      return ok({ content });
    } catch (e) {
      // Only a genuinely absent file falls back to the row snapshot
      // (push-to-yjs keeps it current). Every other failure — permissions,
      // path-too-long, I/O — is a real error the caller must see, not a cue
      // to silently serve a possibly-stale copy.
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn('artifacts: readFileContent failed', {
          resolvedPath,
          error: String(e),
        });
        return err({
          type: 'read_failed' as const,
          message: `Could not read ${resolvedPath}: ${String(e)}`,
        });
      }
      if (args.workItemId) {
        const [row] = db
          .select({ content: artifacts.content })
          .from(artifacts)
          .where(
            and(eq(artifacts.workItemId, args.workItemId), eq(artifacts.filePath, args.filePath))
          )
          .limit(1)
          .all();
        if (row?.content) return ok({ content: row.content });
      }
      return err({
        type: 'not_found' as const,
        message: `File not found at ${resolvedPath} and no saved copy exists`,
      });
    }
  },

  // Newest first, with the id as a tiebreak: created_at is whole seconds here,
  // so comments made in the same second would otherwise come back in whatever
  // order SQLite happened to scan them and the thread list would reshuffle
  // between reads.
  listComments: (args: { artifactId: string }) => {
    if (isArtifactInCloud(args.artifactId)) return err(IN_CLOUD);
    const rows = db
      .select()
      .from(artifactComments)
      .where(eq(artifactComments.artifactId, args.artifactId))
      .orderBy(desc(artifactComments.createdAt), asc(artifactComments.id))
      .all();
    return ok({ comments: rows });
  },

  addComment: async (args: {
    artifactId: string;
    body: string;
    parentCommentId?: string | null;
    anchorKey?: string | null;
    anchorText?: string | null;
  }) => {
    if (isArtifactInCloud(args.artifactId)) return err(IN_CLOUD);
    const authorName = await resolveArtifactAuthorName();
    if (!authorName) return err(NO_IDENTITY);

    const id = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    db.insert(artifactComments)
      .values({
        id,
        artifactId: args.artifactId,
        body: args.body,
        authorName,
        parentCommentId: args.parentCommentId ?? null,
        anchorKey: args.anchorKey ?? null,
        anchorText: args.anchorText ?? null,
        createdAt: now,
      })
      .run();
    const [row] = db.select().from(artifactComments).where(eq(artifactComments.id, id)).all();
    return ok({ comment: row! });
  },

  resolveComment: (args: { commentId: string }) => setCommentResolved(args.commentId, 1),

  unresolveComment: (args: { commentId: string }) => setCommentResolved(args.commentId, 0),

  listVersions: (args: { artifactId: string }) => {
    const rows = db
      .select()
      .from(artifactVersions)
      .where(eq(artifactVersions.artifactId, args.artifactId))
      .orderBy(desc(artifactVersions.versionNumber))
      .all();
    return ok({ versions: rows });
  },

  watchFile: async (args: { artifactId: string; workItemId: string }) => {
    const artifact = await getArtifact(args.artifactId);
    if (!artifact?.filePath) return ok({});
    watchArtifactFile(args.workItemId, args.artifactId, artifact.filePath);
    return ok({});
  },

  unwatchFile: (args: { artifactId: string }) => {
    unwatchArtifactFile(args.artifactId);
    return ok({});
  },

  /**
   * A view showing the work item's artifacts starts watching their sources and
   * gets the current drift; later changes arrive on artifactSourceDriftChannel.
   * Every watch is paired with an unwatch.
   */
  watchSourceDrift: (args: { workItemId: string }) => {
    watchArtifactSources(args.workItemId);
    return ok({ drift: listWorkItemSourceDrift(args.workItemId) });
  },

  unwatchSourceDrift: (args: { workItemId: string }) => {
    unwatchArtifactSources(args.workItemId);
    return ok({});
  },

  /** "Mark reviewed": the drift does not affect the artifact, so the sources' baseline advances. */
  markSourcesReviewed: async (args: { artifactId: string }) => {
    const artifact = await getArtifact(args.artifactId);
    if (!artifact) return err({ type: 'not_found' as const });
    rebaselineArtifactSources(artifact.id);
    reportArtifactSourceDrift(artifact.workItemId);
    return ok({});
  },

  /** `baseVersion`: the version the content was made on (0 for none); a stale base is `conflict`. */
  saveVersion: async (args: {
    artifactId: string;
    content: string;
    trigger: ArtifactVersionTrigger;
    label?: string;
    baseVersion: number;
  }) => {
    const authorName = await resolveArtifactAuthorName();
    if (!authorName) return err(NO_IDENTITY);

    let result;
    try {
      result = await recordArtifactVersion({
        artifactId: args.artifactId,
        content: args.content,
        trigger: args.trigger,
        label: args.label,
        authorName,
        baseVersion: args.baseVersion,
      });
    } catch (error) {
      if (error instanceof PageViewBuildError) return viewBuildFailed(error);
      throw error;
    }
    if (result.status === 'conflict') {
      return err({
        type: 'conflict' as const,
        latestVersion: result.latestVersion,
        message: `Version ${result.latestVersion} was saved while you were editing. Review it, then save again.`,
      });
    }
    updateConfluenceAfterChange({ artifactId: args.artifactId, savedContent: args.content });
    return ok({ version: result.version, warnings: result.warnings });
  },

  /**
   * A page's or file's older version becomes the newest (S7): the file is put
   * back and saved as "Restored vN". `baseVersion` is the latest the user saw.
   */
  restoreVersion: async (args: { artifactId: string; versionId: string; baseVersion: number }) => {
    const authorName = await resolveArtifactAuthorName();
    if (!authorName) return err(NO_IDENTITY);

    let result;
    try {
      result = await restoreArtifactVersion({ ...args, authorName });
    } catch (error) {
      if (error instanceof PageViewBuildError) return viewBuildFailed(error);
      throw error;
    }
    if (result.status === 'conflict') {
      return err({
        type: 'conflict' as const,
        latestVersion: result.latestVersion,
        message: `Version ${result.latestVersion} was saved after you opened the history. Review it, then restore again.`,
      });
    }
    // Pages and files publish their file, which now holds the restored version.
    updateConfluenceAfterChange({ artifactId: args.artifactId });
    return ok({ version: result.version, warnings: result.warnings });
  },
});
