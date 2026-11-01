import type { CloudChatMessage } from '@chord/protocol';
import { create } from 'zustand';
import { centerTabKey, type StripTab } from './center-tab';

export interface MessageRevealRequest {
  messageId: string;
  /** The message's server time, ISO-8601: how far back a feed pages. */
  createdAt: string;
  /** The row as the cloud has it, for a thread that lacks it locally (the owner's). */
  row: CloudChatMessage | null;
  /** The message could not be found: the tab says so instead of scrolling. */
  notFound: boolean;
}

/**
 * "Reveal this message in this tab" (shared-items step 5). A notification
 * click asks; the chat tab takes the request once, whether it was just opened
 * or was already open (the artifact card's pattern, artifact-card-request.ts).
 * Keyed by layout and tab, since one chat can be open in the owner's view and
 * a teammate's. Client-only and never persisted.
 */
export const useMessageRevealRequests = create<{
  requests: Record<string, MessageRevealRequest>;
}>()(() => ({ requests: {} }));

export function messageRevealKey(layoutKey: string, tab: StripTab): string {
  return `${layoutKey}|${centerTabKey(tab)}`;
}

export function requestMessageReveal(
  layoutKey: string,
  tab: StripTab,
  request: MessageRevealRequest
): void {
  const key = messageRevealKey(layoutKey, tab);
  useMessageRevealRequests.setState((state) => ({
    requests: { ...state.requests, [key]: request },
  }));
}

/** The pending request for this tab, removed as it is returned. */
export function takeMessageReveal(layoutKey: string, tab: StripTab): MessageRevealRequest | null {
  const key = messageRevealKey(layoutKey, tab);
  const request = useMessageRevealRequests.getState().requests[key];
  if (!request) return null;
  useMessageRevealRequests.setState((state) => {
    const { [key]: _taken, ...rest } = state.requests;
    return { requests: rest };
  });
  return request;
}
