import { beforeEach, describe, expect, it } from 'vitest';
import {
  requestArtifactCard,
  takeArtifactCardRequest,
  useArtifactCardRequests,
} from './artifact-card-request';

/**
 * "Open this artifact with its comments (or versions) card open" (S8): the
 * rail's 💬 and vN, and a notification click, ask; the artifact's tab takes
 * the request once, whether the tab was already open or not. A notification
 * about a comment also names the comment, so its thread is selected.
 */
describe('artifact card requests', () => {
  beforeEach(() => {
    useArtifactCardRequests.setState({ requests: {} });
  });

  it('hands a request to the artifact it was made for, once', () => {
    requestArtifactCard('a1', 'comments');

    expect(takeArtifactCardRequest('a2')).toBeNull();
    expect(takeArtifactCardRequest('a1')).toEqual({ card: 'comments', commentId: null });
    expect(takeArtifactCardRequest('a1')).toBeNull();
  });

  it('keeps only the latest request for an artifact', () => {
    requestArtifactCard('a1', 'comments');
    requestArtifactCard('a1', 'versions');

    expect(takeArtifactCardRequest('a1')).toEqual({ card: 'versions', commentId: null });
  });

  it('keeps requests for different artifacts apart', () => {
    requestArtifactCard('a1', 'comments');
    requestArtifactCard('a2', 'versions');

    expect(takeArtifactCardRequest('a2')).toEqual({ card: 'versions', commentId: null });
    expect(takeArtifactCardRequest('a1')).toEqual({ card: 'comments', commentId: null });
  });

  it('carries the comment a notification named', () => {
    requestArtifactCard('a1', 'comments', 'c7');

    expect(takeArtifactCardRequest('a1')).toEqual({ card: 'comments', commentId: 'c7' });
  });
});
