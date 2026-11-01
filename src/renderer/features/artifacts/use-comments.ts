import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAccountSession } from '@renderer/lib/hooks/useAccount';
import { useSyncSocketContext } from '@renderer/lib/sync/sync-socket-provider';
import { useWorkItemRoom } from '@renderer/lib/sync/use-work-item-room';
import {
  createArtifactComment,
  listArtifactComments,
  resolveCommentStore,
  setArtifactCommentResolved,
  sortComments,
  type ArtifactCommentView,
  type CommentStore,
} from './artifact-comments-store';
import { artifactCloudApi } from './cloud/artifact-cloud-api';
import { describeCommentFailure, reportCommentFailure } from './comment-failure';
import { runOnCommentStore, type CommentStoreAccess } from './comment-store-moved';
import {
  parsePageForAnchors,
  verifyCommentAnchor,
  type CommentAnchorStatus,
  type ParsedPageForAnchors,
} from './page/comment-anchor-status';
import { invalidateArtifactRailSummary } from './use-artifact-rail-summary';
import { useCommentAgentMessages } from './use-comment-agent-messages';

/** A comment that landed: its id, and whether it is in the cloud, where a mention can point at it. */
export interface CreatedComment {
  id: string;
  inCloud: boolean;
}

interface UseCommentsOptions {
  workItemId: string;
  artifactId: string;
  enabled?: boolean;
  /**
   * A local page's source as it is now, so each element comment is verified
   * against the element its id resolves to before it is shown as anchored or
   * sent to the agent (comment-anchor-status.ts). Null when there is no
   * source to verify against (a document, or a page viewed from the cloud).
   */
  pageSource?: string | null;
}

export function useComments({
  workItemId,
  artifactId,
  enabled = true,
  pageSource = null,
}: UseCommentsOptions) {
  const [comments, setComments] = useState<ArtifactCommentView[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Which artifact a fetch last finished for: before the first one, an empty
  // list means "not read yet", not "no comments".
  const [loadedArtifactId, setLoadedArtifactId] = useState<string | null>(null);
  const { data: session } = useAccountSession();
  const signedIn = session?.isSignedIn === true;
  const senderName = session?.user?.username || session?.user?.email || null;
  const { subscribeEvent } = useSyncSocketContext();
  const queryClient = useQueryClient();
  // comment_created is a room broadcast — an editor open on an artifact whose
  // work item nobody else in this window holds would never receive it. The
  // join is ref-counted, so holding it here costs nothing when a sibling
  // consumer already has it.
  useWorkItemRoom(enabled ? workItemId : undefined);

  // The store is decided once per artifact (per sign-in state) and then used by
  // every read and write below, so a comment is never written to one store and
  // read back from the other.
  const storeRef = useRef<CommentStore | null>(null);
  useEffect(() => {
    storeRef.current = null;
  }, [artifactId, signedIn]);

  // Every read and write runs through runOnCommentStore: an artifact that
  // syncs while this card is open moves its comments to the cloud, and the
  // card follows it there (comment-store-moved.ts).
  const storeAccess = useMemo<CommentStoreAccess>(
    () => ({
      getStore: async (): Promise<CommentStore> => {
        if (storeRef.current) return storeRef.current;
        const store = await resolveCommentStore(artifactId, signedIn);
        storeRef.current = store;
        return store;
      },
      forgetStore: () => {
        storeRef.current = null;
      },
    }),
    [artifactId, signedIn]
  );
  const { getStore } = storeAccess;

  const fetchComments = useCallback(async () => {
    if (!artifactId) return;
    setLoading(true);
    try {
      setComments(
        await runOnCommentStore(storeAccess, (store) =>
          listArtifactComments(store, workItemId, artifactId)
        )
      );
      setLoadError(null);
    } catch (e) {
      // An empty list would read as "no comments yet" — a load that failed has
      // to say so, or a teammate's thread silently disappears.
      console.error('[comments] fetch failed:', e);
      setLoadError(describeCommentFailure('Loading comments', e));
    } finally {
      setLoading(false);
      setLoadedArtifactId(artifactId);
    }
  }, [artifactId, workItemId, storeAccess]);

  useEffect(() => {
    if (enabled) void fetchComments();
  }, [enabled, fetchComments]);

  // A teammate's comment lands as a comment_created ping on the work item's
  // room — thin by design (no body on the wire), so the response is a refetch
  // from whichever store this artifact resolved to. Scoped to this artifact:
  // one work item's room carries pings for every artifact under it.
  useEffect(() => {
    if (!enabled) return;
    return subscribeEvent(
      'comment_created',
      (payload) => {
        if (payload.artifact_id !== artifactId) return;
        void fetchComments();
      },
      workItemId
    );
  }, [enabled, subscribeEvent, fetchComments, artifactId, workItemId]);

  // Reseed backstop for pings broadcast while this window was disconnected:
  // '$sync/connected' fires on every reconnect and whenever gap detection
  // suspects a missed room event.
  useEffect(() => {
    if (!enabled) return;
    return subscribeEvent('$sync/connected', () => {
      void fetchComments();
    });
  }, [enabled, subscribeEvent, fetchComments]);

  const addComment = useCallback(
    async (data: {
      body: string;
      parent_comment_id?: string | null;
      anchor_key?: string | null;
      anchor_text?: string | null;
    }): Promise<CreatedComment | null> => {
      try {
        const { created, store } = await runOnCommentStore(storeAccess, async (store) => ({
          store,
          created: await createArtifactComment(store, workItemId, artifactId, {
            body: data.body,
            parentCommentId: data.parent_comment_id ?? null,
            anchorKey: data.anchor_key ?? null,
            anchorText: data.anchor_text ?? null,
          }),
        }));
        setComments((prev) => sortComments([created, ...prev]));
        setLoadError(null);
        void invalidateArtifactRailSummary(queryClient, workItemId);
        return { id: created.id, inCloud: store === 'cloud' };
      } catch (e) {
        reportCommentFailure('Adding comment', e);
        return null;
      }
    },
    [artifactId, workItemId, storeAccess, queryClient]
  );

  const setResolved = useCallback(
    async (commentId: string, resolved: boolean) => {
      const apply = (value: boolean) =>
        setComments((prev) =>
          prev.map((c) => (c.id === commentId ? { ...c, resolved: value } : c))
        );
      apply(resolved);
      try {
        await runOnCommentStore(storeAccess, (store) =>
          setArtifactCommentResolved(store, workItemId, artifactId, commentId, resolved)
        );
        void invalidateArtifactRailSummary(queryClient, workItemId);
      } catch (e) {
        // Revert the optimistic flip: the stored comment did not change.
        apply(!resolved);
        reportCommentFailure(resolved ? 'Resolving comment' : 'Re-opening comment', e);
      }
    },
    [artifactId, workItemId, storeAccess, queryClient]
  );

  // The caller has seen the comments up to now (S8). Unread lives in the
  // cloud, per account; a comment kept on this device is never unread.
  const markRead = useCallback(async () => {
    try {
      if ((await getStore()) !== 'cloud') return;
      await artifactCloudApi.markCommentsRead(workItemId, artifactId);
      await invalidateArtifactRailSummary(queryClient, workItemId);
    } catch (e) {
      reportCommentFailure('Marking comments read', e);
    }
  }, [artifactId, workItemId, getStore, queryClient]);

  const resolveComment = useCallback(
    (commentId: string) => setResolved(commentId, true),
    [setResolved]
  );

  const unresolveComment = useCallback(
    (commentId: string) => setResolved(commentId, false),
    [setResolved]
  );

  // Parsed once per source, not once per comment per render.
  const parsedPage = useMemo<ParsedPageForAnchors | null>(
    () => (pageSource === null ? null : parsePageForAnchors(pageSource)),
    [pageSource]
  );
  const threads = useMemo(
    () =>
      buildThreads(comments, (root) =>
        verifyCommentAnchor(parsedPage, root.anchorKey, root.anchorText)
      ),
    [comments, parsedPage]
  );

  const { addAllToChat, sendThreadToAgent, sendSelectionToAgent, sendElementToAgent } =
    useCommentAgentMessages({ artifactId, workItemId, senderName, threads });

  return {
    comments,
    threads,
    loading,
    loaded: loadedArtifactId === artifactId,
    loadError,
    addComment,
    resolveComment,
    unresolveComment,
    addAllToChat,
    sendThreadToAgent,
    sendSelectionToAgent,
    sendElementToAgent,
    markRead,
    refetch: fetchComments,
  };
}

export interface CommentThread {
  root: {
    id: string;
    body: string;
    author_name: string;
    anchor_key: string | null;
    anchor_text: string | null;
    /** Whether the anchored element still matches the comment (fix 4); `unverified` without a source. */
    anchorStatus: CommentAnchorStatus;
    resolved: boolean;
    created_at: string;
  };
  replies: Array<{
    id: string;
    body: string;
    author_name: string;
    created_at: string;
  }>;
}

function buildThreads(
  comments: ArtifactCommentView[],
  verifyAnchor: (root: ArtifactCommentView) => CommentAnchorStatus
): CommentThread[] {
  const replyMap = new Map<string, ArtifactCommentView[]>();
  for (const c of comments) {
    if (!c.parentCommentId) continue;
    const existing = replyMap.get(c.parentCommentId) ?? [];
    existing.push(c);
    replyMap.set(c.parentCommentId, existing);
  }

  // Roots newest first, replies oldest first — sorted here as well as in the
  // store so thread order never depends on how the caller assembled the list.
  return sortComments(comments.filter((c) => !c.parentCommentId)).map((root) => ({
    root: {
      id: root.id,
      body: root.body,
      author_name: root.authorName,
      anchor_key: root.anchorKey,
      anchor_text: root.anchorText,
      anchorStatus: verifyAnchor(root),
      resolved: root.resolved,
      created_at: new Date(root.createdAtMs).toISOString(),
    },
    replies: sortComments(replyMap.get(root.id) ?? [])
      .reverse()
      .map((r) => ({
        id: r.id,
        body: r.body,
        author_name: r.authorName,
        created_at: new Date(r.createdAtMs).toISOString(),
      })),
  }));
}
