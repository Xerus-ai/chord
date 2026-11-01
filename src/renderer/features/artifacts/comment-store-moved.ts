import type { CommentStore } from './artifact-comments-store';

/**
 * The device store refused an artifact that reached the cloud since this card
 * resolved its store (devstation-85y): the delivery that synced it took its
 * comments along, and the device keeps none for it any more.
 */
export class CommentStoreMovedError extends Error {
  constructor(message = "This artifact's comments are kept in the cloud now.") {
    super(message);
    this.name = 'CommentStoreMovedError';
  }
}

export interface CommentStoreAccess {
  getStore: () => Promise<CommentStore>;
  forgetStore: () => void;
}

/**
 * Runs a comments read or write on the card's store. When the device store
 * says the artifact moved, the card forgets the store it held, resolves it
 * again and runs the same operation there, once; anything else, or a second
 * refusal, is the caller's to report.
 */
export async function runOnCommentStore<T>(
  access: CommentStoreAccess,
  operation: (store: CommentStore) => Promise<T>
): Promise<T> {
  try {
    return await operation(await access.getStore());
  } catch (error) {
    if (!(error instanceof CommentStoreMovedError)) throw error;
    access.forgetStore();
    return operation(await access.getStore());
  }
}
