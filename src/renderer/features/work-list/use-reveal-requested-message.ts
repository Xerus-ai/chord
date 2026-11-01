import { useEffect, useLayoutEffect, useRef } from 'react';
import { cloudApi } from '@renderer/lib/cloud-api';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { EMPTY_CENTER_LAYOUT } from './center-layout';
import { openCenterTab, useCenterTabsStore } from './center-tabs-store';
import { requestMessageReveal } from './message-reveal-request';
import { participantLayoutKey } from './pane-host';
import type { RequestedMessage } from './requested-message';
import {
  readRevealMessage,
  revealRowOfCloud,
  type RevealMessageRow,
  type RevealReadOutcome,
} from './reveal-message-read';
import { REVEAL_NOT_FOUND } from './reveal-notice';
import { chooseRevealTab, type RevealChat } from './reveal-tab';
import type { WorkItemResolution } from './work-item-resolution-state';

/** Said when the message is in a chat the viewer cannot open (decision 4). */
const REVEAL_HIDDEN = 'That message is in a chat that isn’t shared with you.';

type ChatResolution = Extract<WorkItemResolution, { kind: 'local' | 'cloud' }>;

/** Where this viewer's chats are, and how they read a message. */
interface RevealSource {
  layoutKey: string;
  chats: RevealChat[];
  itemChat: boolean;
  readLocal: (() => Promise<RevealMessageRow | null>) | null;
}

async function loadRevealSource(resolution: ChatResolution, messageId: string) {
  const workItemId = resolution.item.id;
  if (resolution.kind === 'cloud') {
    const chats = (resolution.item.sessions ?? []).map((s) => ({
      id: s.id,
      // Only chats are published.
      kind: 'chat',
      status: s.status,
      lastActiveAt: Date.parse(s.last_active_at),
    }));
    return {
      layoutKey: participantLayoutKey(workItemId),
      chats,
      itemChat: chats.length === 0,
      readLocal: null,
    } satisfies RevealSource;
  }
  const sessions = await rpc.agentSessions.getAll(workItemId);
  if (!sessions.success) throw new Error('Could not read this work item’s chats');
  return {
    layoutKey: workItemId,
    chats: sessions.data.sessions.map((s) => ({
      id: s.id,
      kind: s.kind,
      status: s.status,
      lastActiveAt: s.lastActiveAt,
    })),
    itemChat: false,
    readLocal: async () => {
      const result = await rpc.chatMessages.getMessage(workItemId, messageId);
      if (!result.success) throw new Error('Could not read the message on this machine');
      const row = result.data.message;
      return (
        row && {
          id: row.id,
          sessionId: row.sessionId,
          createdAt: new Date(row.createdAt * 1000).toISOString(),
        }
      );
    },
  } satisfies RevealSource;
}

/**
 * Opens the chat holding a message a navigation asked for (a chat
 * notification, shared-items step 5), once its work item resolves: reads the
 * message (decision 1), picks its tab (decision 5), opens and focuses it, and
 * leaves the tab a request to scroll to the row. A message that cannot be
 * found is said in that chat; one in a chat the viewer cannot see, or a
 * failed read, is said in a toast. The request is consumed at once, so
 * revisiting the item does not reveal it again.
 */
export function useRevealRequestedMessage(
  resolution: WorkItemResolution,
  requested: RequestedMessage | undefined,
  consumeRequest: () => void
): void {
  // The resolution object changes identity on every refetch; the reveal runs
  // once per request, reading the latest one (a layout effect, so it is
  // current before the effect below).
  const resolutionRef = useRef(resolution);
  useLayoutEffect(() => {
    resolutionRef.current = resolution;
  }, [resolution]);
  const resolvedId =
    resolution.kind === 'local' ||
    resolution.kind === 'cloud' ||
    resolution.kind === 'artifacts_only'
      ? resolution.item.id
      : null;

  useEffect(() => {
    if (!requested || resolvedId !== requested.workItemId) return;
    consumeRequest();
    const current = resolutionRef.current;
    if (current.kind === 'artifacts_only') {
      toast({ title: REVEAL_HIDDEN });
      return;
    }
    if (current.kind !== 'local' && current.kind !== 'cloud') return;
    void revealMessage(current, requested).catch((error: unknown) => {
      toast({
        title: 'Couldn’t open that message',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    });
  }, [requested, resolvedId, consumeRequest]);
}

async function revealMessage(resolution: ChatResolution, requested: RequestedMessage) {
  const { workItemId, messageId } = requested;
  const source = await loadRevealSource(resolution, messageId);
  const outcome: RevealReadOutcome = await readRevealMessage({
    readLocal: source.readLocal,
    readCloud: async () => revealRowOfCloud(await cloudApi.getMessage(workItemId, messageId)),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  if (outcome.kind === 'hidden') {
    toast({ title: REVEAL_HIDDEN });
    return;
  }
  if (outcome.kind === 'failed') throw new Error(outcome.message);

  const layout = useCenterTabsStore.getState().layouts[source.layoutKey] ?? EMPTY_CENTER_LAYOUT;
  const found = outcome.kind === 'found' ? outcome.message : null;
  const tab = chooseRevealTab({
    layout,
    sessionId: found ? found.sessionId : null,
    chats: source.chats,
    itemChat: source.itemChat,
  });
  if (!tab) {
    toast({ title: REVEAL_NOT_FOUND });
    return;
  }
  requestMessageReveal(source.layoutKey, tab, {
    messageId,
    createdAt: found?.createdAt ?? '',
    row: found?.cloudRow ?? null,
    notFound: found === null,
  });
  openCenterTab(source.layoutKey, tab);
}
