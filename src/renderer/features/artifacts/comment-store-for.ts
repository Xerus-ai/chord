import type { CommentStore } from './artifact-comments-store';

/**
 * Which store holds an artifact's comments, for an artifact this device has a
 * row for: the cloud once the sync queue registered it (it has a cloud id)
 * and the user is signed in, otherwise this device. Pure, so the rail's
 * counts and the comments card resolve the store by the same rule.
 */
export function commentStoreFor(cloudId: string | null, signedIn: boolean): CommentStore {
  return signedIn && cloudId ? 'cloud' : 'local';
}
