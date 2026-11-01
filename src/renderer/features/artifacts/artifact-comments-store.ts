import {
  artifactCloudApi,
  type ArtifactComment,
} from '@renderer/features/artifacts/cloud/artifact-cloud-api';
import { rpc } from '@renderer/lib/ipc';
import { commentStoreFor } from './comment-store-for';
import { CommentStoreMovedError } from './comment-store-moved';

/**
 * Where an artifact's comments live.
 *
 * `cloud` is the store for every artifact that reached the cloud (its row was
 * pushed by the sync queue) while the user is signed in — the only store a
 * mentioned teammate can actually read, which is what makes an @mention
 * notification openable on their machine. `local` is the offline store for
 * artifacts that never synced: comments stay in SQLite on this device.
 *
 * Exactly one store is used per artifact, resolved once and then honored by
 * every read and write — never both. The one move is local → cloud, when the
 * artifact syncs: its comments go along, and the device store then refuses it
 * (comment-store-moved.ts).
 */
export type CommentStore = 'cloud' | 'local';

/** One comment, normalized so the UI never branches on which store it came from. */
export interface ArtifactCommentView {
  id: string;
  parentCommentId: string | null;
  body: string;
  authorName: string;
  /** What the comment is on: `chord-id:<id>` for a page element (page/picked-element.ts), else null. */
  anchorKey: string | null;
  anchorText: string | null;
  resolved: boolean;
  /** Epoch milliseconds — the single ordering key for both stores. */
  createdAtMs: number;
}

export interface NewComment {
  body: string;
  parentCommentId: string | null;
  anchorKey: string | null;
  anchorText: string | null;
}

interface LocalCommentRow {
  id: string;
  parentCommentId: string | null;
  body: string;
  authorName: string;
  anchorKey: string | null;
  anchorText: string | null;
  resolved: number;
  createdAt: number;
}

function fromLocalRow(row: LocalCommentRow): ArtifactCommentView {
  return {
    id: row.id,
    parentCommentId: row.parentCommentId,
    body: row.body,
    authorName: row.authorName,
    anchorKey: row.anchorKey,
    anchorText: row.anchorText,
    resolved: row.resolved === 1,
    createdAtMs: row.createdAt * 1000,
  };
}

function fromCloudRow(row: ArtifactComment): ArtifactCommentView {
  return {
    id: row.id,
    parentCommentId: row.parent_comment_id,
    body: row.body,
    authorName: row.author_name,
    anchorKey: row.anchor_key,
    anchorText: row.anchor_text,
    resolved: row.resolved,
    createdAtMs: Date.parse(row.created_at),
  };
}

/** Newest first, id as the tiebreak — the same order both stores are read in. */
export function sortComments(comments: ArtifactCommentView[]): ArtifactCommentView[] {
  return [...comments].sort(
    (a, b) => b.createdAtMs - a.createdAtMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/**
 * Decides which store this artifact's comments belong to.
 *
 * Signed out, there is no cloud to talk to. Signed in, an artifact the sync
 * queue already registered with the cloud is a cloud artifact — and so is one
 * with no local row at all, which is how a shared work item's artifact looks
 * on a participant's device (`get` only ever fails with not_found). Everything
 * left is a local artifact that never synced.
 */
export async function resolveCommentStore(
  artifactId: string,
  signedIn: boolean
): Promise<CommentStore> {
  if (!signedIn) return 'local';
  const result = await rpc.artifacts.get(artifactId);
  if (!result.success) return 'cloud';
  return commentStoreFor(result.data.artifact.cloudId, signedIn);
}

export async function listArtifactComments(
  store: CommentStore,
  workItemId: string,
  artifactId: string
): Promise<ArtifactCommentView[]> {
  if (store === 'cloud') {
    const rows = await artifactCloudApi.getComments(workItemId, artifactId);
    return sortComments(rows.map(fromCloudRow));
  }

  const result = await rpc.artifacts.listComments({ artifactId });
  if (!result.success) throw new CommentStoreMovedError(result.error.message);
  return sortComments(result.data.comments.map(fromLocalRow));
}

export async function createArtifactComment(
  store: CommentStore,
  workItemId: string,
  artifactId: string,
  input: NewComment
): Promise<ArtifactCommentView> {
  if (store === 'cloud') {
    const created = await artifactCloudApi.createComment(workItemId, artifactId, {
      body: input.body,
      parent_comment_id: input.parentCommentId,
      anchor_key: input.anchorKey,
      anchor_text: input.anchorText,
    });
    return fromCloudRow(created);
  }

  const result = await rpc.artifacts.addComment({
    artifactId,
    body: input.body,
    parentCommentId: input.parentCommentId,
    anchorKey: input.anchorKey,
    anchorText: input.anchorText,
  });
  if (!result.success) {
    if (result.error.type === 'artifact_in_cloud') {
      throw new CommentStoreMovedError(result.error.message);
    }
    throw new Error(result.error.message ?? `Comment could not be saved: ${result.error.type}`);
  }
  return fromLocalRow(result.data.comment);
}

export async function setArtifactCommentResolved(
  store: CommentStore,
  workItemId: string,
  artifactId: string,
  commentId: string,
  resolved: boolean
): Promise<void> {
  if (store === 'cloud') {
    if (resolved) {
      await artifactCloudApi.resolveComment(workItemId, artifactId, commentId);
    } else {
      await artifactCloudApi.unresolveComment(workItemId, artifactId, commentId);
    }
    return;
  }

  const result = resolved
    ? await rpc.artifacts.resolveComment({ commentId })
    : await rpc.artifacts.unresolveComment({ commentId });
  if (!result.success) {
    if (result.error.type === 'artifact_in_cloud') {
      throw new CommentStoreMovedError(result.error.message);
    }
    throw new Error(`Comment could not be updated: ${result.error.type}`);
  }
}
