import { useCallback, useMemo, useState } from 'react';
import {
  documentAnchorsFor,
  filterThreads,
  numberThreads,
  pagePinsFor,
  threadForComment,
  threadForNumber,
  type CommentFilter,
  type NumberedThread,
} from './comment-numbering';
import type { DocumentCommentBadges } from './document-comment-badges';
import type { CommentThread } from './use-comments';

interface UseCommentsCardOptions {
  threads: CommentThread[];
  /** Whether the threads have been read; a requested comment is looked for once they have. */
  loaded: boolean;
  /** Whether the comments card is open. */
  open: boolean;
  /** Opens the card: a pin or badge was clicked while it was closed. */
  onOpen: () => void;
  /** A comment a notification named: its thread is selected once the threads load. */
  focusCommentId: string | null;
  /** The focus request was handled, whether or not a thread still holds the comment. */
  onFocusHandled: () => void;
}

/**
 * The comments card's state, shared by the card and the content (S6): one
 * numbering, one filter and one selection, so a pin, a badge and a card row
 * always name the same thread. With the card closed the content shows the
 * open threads; with it open, whatever the card's filter shows.
 */
export function useCommentsCard({
  threads,
  loaded,
  open,
  onOpen,
  focusCommentId,
  onFocusHandled,
}: UseCommentsCardOptions) {
  const [filter, setFilterState] = useState<CommentFilter>('open');
  const [selected, setSelected] = useState<number | null>(null);

  const numbered = useMemo(() => numberThreads(threads), [threads]);
  const visible = useMemo(
    () => filterThreads(numbered, open ? filter : 'open'),
    [numbered, filter, open]
  );
  const counts = useMemo(
    () => ({
      open: filterThreads(numbered, 'open').length,
      resolved: filterThreads(numbered, 'resolved').length,
    }),
    [numbered]
  );
  const pins = useMemo(() => pagePinsFor(visible), [visible]);
  const documentAnchors = useMemo(() => documentAnchorsFor(visible), [visible]);

  const setFilter = useCallback((next: CommentFilter) => {
    setFilterState(next);
    setSelected(null);
  }, []);

  /** Select a thread under the filter that shows it, opening the card. */
  const selectEntry = useCallback(
    (entry: NumberedThread) => {
      setFilterState(entry.thread.root.resolved ? 'resolved' : 'open');
      setSelected(entry.n);
      onOpen();
    },
    [onOpen]
  );

  /** A pin or badge was clicked: open the card on that thread, under its filter. */
  const selectNumber = useCallback(
    (n: number) => {
      const entry = threadForNumber(numbered, n);
      if (entry) selectEntry(entry);
    },
    [numbered, selectEntry]
  );

  // Adjusted while rendering, not in an effect (react.dev, "Adjusting some
  // state when a prop changes"): once the threads are read, select the one
  // holding the notification's comment. A comment deleted since is held by no
  // thread, and the card stays open on its list. The card is already open:
  // the same request opened it.
  if (focusCommentId !== null && loaded) {
    const entry = threadForComment(numbered, focusCommentId);
    if (entry) {
      setFilterState(entry.thread.root.resolved ? 'resolved' : 'open');
      setSelected(entry.n);
    }
    onFocusHandled();
  }

  // A closed card selects nothing; reopening it returns to the thread it was on.
  const activeSelected = open ? selected : null;
  const documentBadges = useMemo<DocumentCommentBadges>(
    () => ({ anchors: documentAnchors, selected: activeSelected, onSelect: selectNumber }),
    [documentAnchors, activeSelected, selectNumber]
  );

  return {
    filter,
    setFilter,
    visible,
    counts,
    selected: activeSelected,
    select: setSelected,
    selectNumber,
    pins,
    documentBadges,
  };
}
