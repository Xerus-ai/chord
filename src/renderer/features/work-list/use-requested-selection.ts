import { useState } from 'react';

/**
 * The work item the work list shows. Params are the navigation channel
 * (sidebar click, deep link, Create): a newly requested id is adopted during
 * render. Clearing params does NOT clear the selection — a revoked item keeps
 * its terminal card on screen while the cleared params guarantee the dead id
 * is never re-imposed later.
 *
 * The last id seen is state, not a ref. Navigation sets params in a
 * transition, and React throws away a transition render that a synchronous
 * update (any zustand store) interrupts — with the selection it set. A ref
 * written in that render would survive it and swallow the request: the old
 * item stayed on screen (devstation-cz3a).
 */
export function useRequestedSelection(incomingId: string | null): string | null {
  const [selectedId, setSelectedId] = useState<string | null>(incomingId);
  const [seenIncomingId, setSeenIncomingId] = useState(incomingId);
  if (incomingId !== seenIncomingId) {
    setSeenIncomingId(incomingId);
    if (incomingId) setSelectedId(incomingId);
  }
  return selectedId;
}
