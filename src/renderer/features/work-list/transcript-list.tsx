import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAccountSession } from '@renderer/lib/hooks/useAccount';
import { AgentTurnView } from './agent-turn';
import { MessageRow, SystemEventRow } from './chat-message-row';
import { findForgottenRows } from './history-reset-rows';
import { useRetainedPanelActive } from './retained-panel';
import { SessionDivider } from './session-divider';
import { findRevealIndex } from './transcript-reveal';
import type { TranscriptItem } from './transcript-rows';
import type { OpenArtifactHandler } from './turn-artifact-chips';
import {
  buildTurnHistoryActions,
  type TurnHistoryAction,
  type TurnHistoryHandlers,
} from './turn-history-actions';

export type TranscriptMessageItem = Extract<TranscriptItem, { type: 'message' }>;

/** What a source adds to one message row: dimmed while unsent, and a note under it. */
export interface EntryDecoration {
  pending: boolean;
  annotation: ReactNode;
}

/** A message to scroll to and light up (shared-items step 5); `nonce` makes a repeat a new reveal. */
export interface TranscriptReveal {
  messageId: string;
  nonce: number;
}

/** How long a revealed row stays lit, then how long it takes to fade (decision 6). */
const REVEAL_HOLD_MS = 2_000;
const REVEAL_FADE_MS = 1_000;

function itemKeyOf(item: TranscriptItem): string {
  if (item.type === 'turn') return `turn:${item.turn.id}`;
  if (item.type === 'divider') return item.key;
  return `entry:${item.entry.id}`;
}

/**
 * The scrolling, virtualized row list every chat thread renders, owner's and
 * teammate's alike: chat rows and agent turns in the order given, pinned to
 * the bottom while the reader is already there. What differs by source comes
 * in as props: where an artifact chip opens, checkpoints, and per-row
 * decoration. A `reveal` scrolls one message into the middle of the view and
 * lights it up; the bottom pin lets go until the reader scrolls back down.
 */
export function TranscriptList({
  items,
  workItemId,
  workspaceRoot,
  followKey,
  onOpenArtifact,
  checkpoints,
  header,
  emptyLabel = 'No messages yet',
  decorateEntry,
  reveal = null,
  onRevealed,
}: {
  items: readonly TranscriptItem[];
  workItemId: string;
  /** Root created-file chips show paths relative to; null when unknown. */
  workspaceRoot: string | null;
  /** Changes whenever new content should pull a bottom-pinned reader down. */
  followKey: string;
  /** Opens an artifact chip's tab in this view's layout. */
  onOpenArtifact: OpenArtifactHandler;
  /** The owner's per-turn checkpoints and Reset; null where the viewer cannot reset (a teammate). */
  checkpoints: TurnHistoryHandlers | null;
  /** Above the rows, outside the scroll: e.g. "Load earlier messages". */
  header?: ReactNode;
  emptyLabel?: string;
  decorateEntry?: (item: TranscriptMessageItem) => EntryDecoration;
  /** A message in `items` to scroll to and light up. */
  reveal?: TranscriptReveal | null;
  /** The reveal has scrolled; the caller can drop it. */
  onRevealed?: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const savedScrollTopRef = useRef(0);
  const { data: account } = useAccountSession();
  const active = useRetainedPanelActive();

  const getItemKey = useCallback((index: number) => itemKeyOf(items[index]), [items]);

  // What a Reset dropped from an agent's memory renders dimmed, for everyone.
  const forgotten = useMemo(() => findForgottenRows(items), [items]);
  // Kept per handlers: a turn whose Reset did not change keeps its object, so
  // the memoized turn rows don't all re-render on every streamed item.
  const historyCacheRef = useRef<{
    handlers: TurnHistoryHandlers | null;
    actions: ReadonlyMap<string, TurnHistoryAction>;
  }>({ handlers: null, actions: new Map() });
  const historyActions = useMemo(() => {
    if (!checkpoints) return null;
    const cache = historyCacheRef.current;
    const previous = cache.handlers === checkpoints ? cache.actions : new Map();
    const actions = buildTurnHistoryActions(items, checkpoints, previous);
    historyCacheRef.current = { handlers: checkpoints, actions };
    return actions;
  }, [items, checkpoints]);

  const virtualizer = useVirtualizer({
    count: items.length,
    // Key by row identity, not position: cloud messages arrive late and slot in
    // mid-list, and index keys would leave every later row with its
    // predecessor's measured height.
    getItemKey,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 80,
    overscan: 5,
  });

  // A hidden panel collapses to zero height: rows measure at zero and the
  // browser clamps scrollTop. On reveal, re-measure the mounted rows in place
  // (`measure()` would wipe sizes the ResizeObserver already reported, leaving
  // unchanged rows stuck at the estimate and overlapping), then put the reader
  // back — the bottom if they were following, else their offset.
  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (!el) return;
      el.querySelectorAll<HTMLElement>('[data-index]').forEach(virtualizer.measureElement);
      if (isNearBottomRef.current) {
        if (items.length > 0) virtualizer.scrollToIndex(items.length - 1, { align: 'end' });
      } else {
        el.scrollTop = savedScrollTopRef.current;
      }
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restore only when visibility flips
  }, [active, virtualizer]);

  // Splitting or moving panes re-parents this panel's DOM (`RetainedBodyHost`)
  // without any visibility change React could see; the box collapses to zero
  // while detached. Snapshot the reader's place when it collapses and put it
  // back once it has a size again.
  const itemCountRef = useRef(items.length);
  useEffect(() => {
    itemCountRef.current = items.length;
  }, [items.length]);
  // A reveal asked for while the box has no size (a tab just opened, or
  // re-parented) waits here; it is placed once the box has a size, in place
  // of the restore below.
  const pendingRevealRef = useRef<string | null>(null);
  const placeRevealRef = useRef<(messageId: string) => boolean>(() => false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let snapshot: { top: number; nearBottom: boolean } | null = null;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (el.clientHeight === 0) {
        snapshot ??= { top: savedScrollTopRef.current, nearBottom: isNearBottomRef.current };
        return;
      }
      const pending = pendingRevealRef.current;
      if (!snapshot && !pending) return;
      const restore = snapshot;
      snapshot = null;
      if (restore) {
        savedScrollTopRef.current = restore.top;
        isNearBottomRef.current = restore.nearBottom;
      }
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        el.querySelectorAll<HTMLElement>('[data-index]').forEach(virtualizer.measureElement);
        if (pending && placeRevealRef.current(pending)) return;
        if (!restore) return;
        if (!restore.nearBottom) el.scrollTop = restore.top;
        else if (itemCountRef.current > 0) {
          virtualizer.scrollToIndex(itemCountRef.current - 1, { align: 'end' });
        }
      });
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [virtualizer]);

  useEffect(() => {
    if (!isNearBottomRef.current || items.length === 0) return;
    requestAnimationFrame(() => {
      virtualizer.scrollToIndex(items.length - 1, { align: 'end' });
    });
  }, [followKey, items.length, virtualizer]);

  // Streamed text grows the last row without adding one, so `followKey` does
  // not change and no scroll event fires: a reader following the reply was
  // left where it started. While pinned, keep the bottom in view as the
  // content grows, once per frame.
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (!isNearBottomRef.current || el.clientHeight === 0) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (isNearBottomRef.current) el.scrollTop = el.scrollHeight;
      });
    });
    observer.observe(content);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  // A reveal: the pin lets go first, so neither the follow effect above nor a
  // row arriving mid-scroll pulls the reader to the bottom; the scroll is
  // repeated over two frames, as rows measured on the way in move the target
  // off its estimated place. A hidden panel waits until it is shown, and a box
  // with no size until it has one.
  const [lit, setLit] = useState<{ id: string; fading: boolean } | null>(null);
  const revealFramesRef = useRef<number[]>([]);
  const revealTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const lastRevealRef = useRef(0);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(() => {
    placeRevealRef.current = (messageId: string) => {
      const el = scrollRef.current;
      const index = findRevealIndex(itemsRef.current, messageId);
      if (!el || el.clientHeight === 0 || index < 0) return false;
      pendingRevealRef.current = null;
      isNearBottomRef.current = false;
      // The saved offset follows the scroll at once: a re-parent before the
      // scroll event would otherwise restore the place the reader left.
      const center = () => {
        virtualizer.scrollToIndex(index, { align: 'center' });
        savedScrollTopRef.current = el.scrollTop;
      };
      center();
      revealFramesRef.current.push(
        requestAnimationFrame(() => {
          center();
          revealFramesRef.current.push(requestAnimationFrame(center));
        })
      );
      revealTimersRef.current.forEach(clearTimeout);
      setLit({ id: messageId, fading: false });
      revealTimersRef.current = [
        setTimeout(() => setLit({ id: messageId, fading: true }), REVEAL_HOLD_MS),
        setTimeout(() => setLit(null), REVEAL_HOLD_MS + REVEAL_FADE_MS),
      ];
      return true;
    };
  }, [virtualizer]);
  useEffect(() => {
    if (!reveal || !active || reveal.nonce === lastRevealRef.current) return;
    if (findRevealIndex(items, reveal.messageId) < 0) return;
    lastRevealRef.current = reveal.nonce;
    isNearBottomRef.current = false;
    if (!placeRevealRef.current(reveal.messageId)) pendingRevealRef.current = reveal.messageId;
    onRevealed?.();
  }, [reveal, active, items, onRevealed]);
  useEffect(
    () => () => {
      revealFramesRef.current.forEach(cancelAnimationFrame);
      revealTimersRef.current.forEach(clearTimeout);
    },
    []
  );

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    // Scrolls while hidden are the browser clamping a collapsed box, not the reader.
    if (!el || el.clientHeight === 0) return;
    savedScrollTopRef.current = el.scrollTop;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
  }, []);

  return (
    <>
      {header}
      <div
        ref={scrollRef}
        data-testid="chat-transcript"
        onScroll={handleScroll}
        // `pb-40` here used to reserve a strip for the floating composer dock.
        // The dock is in flow now and occupies its own space, so that reservation
        // is a dead gap under the last message.
        className="min-h-0 flex-1 overflow-y-auto px-6 pt-8 pb-6"
      >
        {/* §11: a short noun phrase, centred and muted. No illustration and no
          CTA — the composer directly below is the call to action, and an empty
          transcript is a starting point, not an error to recover from. */}
        {items.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <span className="text-body tracking-body text-text-muted">{emptyLabel}</span>
          </div>
        )}
        <div
          ref={contentRef}
          style={{
            height: virtualizer.getTotalSize(),
            width: '100%',
            maxWidth: 'var(--max-content-width)',
            marginInline: 'auto',
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const item = items[virtualRow.index];
            const decoration = item.type === 'message' ? decorateEntry?.(item) : undefined;
            const entryId = item.type === 'message' ? item.entry.id : undefined;
            const litHere = lit !== null && lit.id === entryId;
            const forgottenRow = forgotten.get(virtualRow.index);
            return (
              <div
                key={virtualRow.key}
                ref={virtualizer.measureElement}
                data-index={virtualRow.index}
                data-entry-id={entryId}
                data-revealed={litHere ? 'true' : undefined}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                className={`flex flex-col pb-[var(--stream-gap-turn)] ${decoration?.pending ? 'opacity-60' : ''}`}
              >
                {forgottenRow?.startsRun && (
                  <div className="mb-2 text-tiny tracking-tiny text-text-passive">
                    Not in {forgottenRow.agentName}&apos;s memory since the reset
                  </div>
                )}
                {/* The reveal tint hugs the row, not the gap under it. */}
                <div
                  className={`flex flex-col rounded-md transition-colors duration-1000 ease-out motion-reduce:transition-none ${litHere && !lit.fading ? 'bg-reveal-bg' : ''} ${forgottenRow ? 'opacity-50' : ''}`}
                >
                  {item.type === 'turn' ? (
                    <AgentTurnView
                      turn={item.turn}
                      workItemId={workItemId}
                      workspaceRoot={workspaceRoot}
                      onOpenArtifact={onOpenArtifact}
                      history={historyActions?.get(item.turn.id)}
                    />
                  ) : item.type === 'divider' ? (
                    <SessionDivider ordinal={item.ordinal} startedAt={item.startedAt} />
                  ) : item.entry.kind === 'message' ? (
                    <MessageRow
                      entry={item.entry}
                      workItemId={workItemId}
                      currentUserId={account?.user?.userId ?? null}
                      onOpenArtifact={onOpenArtifact}
                    />
                  ) : (
                    <SystemEventRow entry={item.entry} />
                  )}
                  {decoration?.annotation}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
