import { createContext, useContext } from 'react';
import type { ArtifactSource } from './artifact-surface';

/**
 * Whether comments on this artifact can @mention people. Mentions draw on the
 * work item's roster and notify through its route, both closed to someone the
 * artifact alone was shared with — for them a comment is plain text.
 */
export function canMentionInComments(input: {
  source: ArtifactSource;
  hasWorkItemAccess: boolean;
}): boolean {
  return input.source === 'local' || input.hasWorkItemAccess;
}

export const CommentMentionsContext = createContext<boolean | null>(null);

export function useCommentMentionsEnabled(): boolean {
  const enabled = useContext(CommentMentionsContext);
  if (enabled === null) {
    throw new Error('useCommentMentionsEnabled must be used inside a CommentMentionsContext');
  }
  return enabled;
}
