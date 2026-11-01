import { useCallback, useEffect, useRef, useState } from 'react';
import type { StripTab } from './center-tab';
import {
  messageRevealKey,
  takeMessageReveal,
  useMessageRevealRequests,
  type MessageRevealRequest,
} from './message-reveal-request';
import type { TranscriptReveal } from './transcript-list';
import { findRevealIndex } from './transcript-reveal';
import type { TranscriptItem } from './transcript-rows';

type Phase =
  | { kind: 'idle' }
  /** Waiting for the thread's history to be in, then loading through the target. */
  | { kind: 'waiting'; request: MessageRevealRequest }
  | { kind: 'loading'; request: MessageRevealRequest }
  | { kind: 'loaded'; request: MessageRevealRequest }
  | { kind: 'revealing'; reveal: TranscriptReveal }
  | { kind: 'missing' };

/**
 * One chat tab's side of a reveal (shared-items step 5): take the request
 * addressed to this tab, wait for the thread's history, load through the
 * message (`ensureLoaded`: the teammate pages back, the owner adds the cloud
 * row it lacks), then hand the transcript the row to scroll to, or say the
 * message cannot be found. Never a silent landing at the bottom.
 */
export function useThreadReveal({
  layoutKey,
  tab,
  items,
  ready,
  ensureLoaded,
}: {
  layoutKey: string;
  tab: StripTab;
  items: readonly TranscriptItem[];
  /** The thread's history is in (the first page, or the local rows). */
  ready: boolean;
  /** Resolves whether the thread now holds the message. */
  ensureLoaded: (request: MessageRevealRequest) => Promise<boolean>;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const nonceRef = useRef(0);
  const key = messageRevealKey(layoutKey, tab);
  const pending = useMessageRevealRequests((store) => store.requests[key] ?? null);

  useEffect(() => {
    if (!pending) return;
    const request = takeMessageReveal(layoutKey, tab);
    if (!request) return;
    setPhase(request.notFound ? { kind: 'missing' } : { kind: 'waiting', request });
    // `tab` is identified by `key`; its object identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, layoutKey, key]);

  useEffect(() => {
    if (phase.kind === 'waiting' && ready) setPhase({ kind: 'loading', request: phase.request });
  }, [phase, ready]);

  useEffect(() => {
    if (phase.kind !== 'loading') return;
    let stale = false;
    const { request } = phase;
    ensureLoaded(request).then(
      (held) => {
        if (!stale) setPhase(held ? { kind: 'loaded', request } : { kind: 'missing' });
      },
      () => {
        if (!stale) setPhase({ kind: 'missing' });
      }
    );
    return () => {
      stale = true;
    };
  }, [phase, ensureLoaded]);

  // The rows `ensureLoaded` merged are in state when it resolves, so the
  // target is in `items` now or it is not in this thread at all.
  useEffect(() => {
    if (phase.kind !== 'loaded') return;
    const { messageId } = phase.request;
    if (findRevealIndex(items, messageId) < 0) {
      setPhase({ kind: 'missing' });
      return;
    }
    nonceRef.current += 1;
    setPhase({ kind: 'revealing', reveal: { messageId, nonce: nonceRef.current } });
  }, [phase, items]);

  const dismissNotice = useCallback(() => setPhase({ kind: 'idle' }), []);
  const onRevealed = useCallback(() => setPhase({ kind: 'idle' }), []);

  return {
    reveal: phase.kind === 'revealing' ? phase.reveal : null,
    onRevealed,
    notFound: phase.kind === 'missing',
    dismissNotice,
  };
}
