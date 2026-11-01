import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { isValidProviderId } from '@shared/agent-provider-registry';
import { getProvider } from '@shared/agent-providers';
import {
  artifactPathTab,
  ITEM_CHAT_TAB,
  type StripTab,
} from '@renderer/features/work-list/center-tab';
import { openCenterTab, type OpenTabOptions } from '@renderer/features/work-list/center-tabs-store';
import { ChatInput } from '@renderer/features/work-list/chat-input';
import { ChatThreadView } from '@renderer/features/work-list/chat-thread-view';
import { mentionKindsFor } from '@renderer/features/work-list/composer-access';
import { MentionRosterProvider } from '@renderer/features/work-list/mention-roster';
import type { MessageRevealRequest } from '@renderer/features/work-list/message-reveal-request';
import { RevealNotice } from '@renderer/features/work-list/reveal-notice';
import {
  TranscriptList,
  type EntryDecoration,
  type TranscriptMessageItem,
} from '@renderer/features/work-list/transcript-list';
import { useMentionRoster } from '@renderer/features/work-list/use-mention-roster';
import { useParticipants } from '@renderer/features/work-list/use-participants';
import { useThreadReveal } from '@renderer/features/work-list/use-thread-reveal';
import {
  useWorkItemSource,
  type WorkItemSource,
} from '@renderer/features/work-list/work-item-source';
import { useAccountSession } from '@renderer/lib/hooks/useAccount';
import { ChatRowAnnotation, rowAlignOf } from './chat-row-annotation';
import { CloudApprovalCards } from './cloud-approval-cards';
import { useCloudChatContext } from './cloud-chat-context';
import { CommandStatusChip } from './command-status-chip';
import { selectThreadMessages } from './participant-threads';
import { buildCloudTranscript } from './participant-timeline';
import { cloudArtifactListKey } from './use-cloud-artifact-list';
import { useCloudThreadComposer } from './use-cloud-thread-composer';

function cloudSourceOf(source: WorkItemSource): Extract<WorkItemSource, { kind: 'cloud' }> {
  if (source.kind !== 'cloud')
    throw new Error('A cloud chat thread needs a cloud work item source');
  return source;
}

function LoadEarlierButton({ onClick }: { onClick: () => void }) {
  return (
    <div className="flex shrink-0 justify-center pt-3">
      <button
        onClick={onClick}
        className="cursor-pointer rounded-sm border border-border bg-surface-inset px-3 py-1 text-tiny tracking-tiny font-medium text-text-muted transition-colors hover:bg-surface-hover-solid"
      >
        Load earlier messages
      </button>
    </div>
  );
}

/**
 * A teammate's chat tab: one of the owner's chats (its rows plus the item's
 * session-less history), or, with `sessionId` null, the item's whole chat
 * while the owner has published none. Rows come from the item's one
 * `CloudChatProvider` feed and render in the owner's `TranscriptList`.
 */
export function CloudChatThread({ sessionId }: { sessionId: string | null }) {
  const { item, layoutKey, capabilities } = cloudSourceOf(useWorkItemSource());
  const { feed, statuses } = useCloudChatContext();
  const { data: accountSession } = useAccountSession();
  const queryClient = useQueryClient();
  // What the owner's chat runs, as their app published it (none for the item
  // chat, which holds no session); an ended chat takes no more messages.
  const published = sessionId ? item.sessions?.find((s) => s.id === sessionId) : undefined;
  const composer = useCloudThreadComposer(item, sessionId, capabilities, {
    ended: published?.status === 'done',
  });
  const { participants } = useParticipants(item.id);
  const mentionRoster = useMentionRoster({
    workItemId: item.id,
    viewer: 'member',
    participants,
    enabled: true,
  });
  const roster = mentionRoster ?? participants;
  // Items created before a provider was recorded carry null, and the column is
  // a free string on the wire — anything unrecognised falls back to the
  // generic word rather than rendering a raw id in the menu.
  const agentLabel = isValidProviderId(item.agent_provider)
    ? (getProvider(item.agent_provider)?.name ?? 'Agent')
    : 'Agent';
  const ownerAgent = published && {
    agentProviderId: published.agent_provider_id,
    modelLabel: published.model_label,
    permissionModeLabel: published.permission_mode_label,
  };

  const selfUserId = accountSession?.user?.userId ?? null;
  const deviceOnline = item.creator_device_online ?? false;
  const { messages, pendingIds, failedIds } = feed;

  const items = useMemo(
    () => buildCloudTranscript(selectThreadMessages(messages, sessionId)),
    [messages, sessionId]
  );

  // A notification's message (step 5): page the item's feed back to it.
  const tab = useMemo<StripTab>(
    () => (sessionId ? { kind: 'session', sessionId } : ITEM_CHAT_TAB),
    [sessionId]
  );
  const { loadThrough } = feed;
  const ensureLoaded = useCallback(
    (request: MessageRevealRequest) =>
      loadThrough({ created_at: request.createdAt, id: request.messageId }),
    [loadThrough]
  );
  const threadReveal = useThreadReveal({
    layoutKey,
    tab,
    items,
    ready: feed.seeded,
    ensureLoaded,
  });

  const onOpenArtifact = useCallback(
    (artifactId: string, title: string, options?: OpenTabOptions) => {
      openCenterTab(layoutKey, artifactPathTab(artifactId, title), options);
      void queryClient.invalidateQueries({ queryKey: cloudArtifactListKey(item.id) });
    },
    [queryClient, layoutKey, item.id]
  );

  // Unsent rows dim; a rejected one says so; a prompt sent as a command shows
  // whether the owner's device took it.
  const decorateEntry = useCallback(
    ({ entry, commandId }: TranscriptMessageItem): EntryDecoration => {
      const pending = pendingIds.has(entry.id);
      if (entry.kind !== 'message') return { pending, annotation: null };
      const align = rowAlignOf(entry, selfUserId);
      return {
        pending,
        annotation: (
          <>
            {failedIds.has(entry.id) && (
              <ChatRowAnnotation align={align}>
                <span className="text-tiny tracking-tiny text-status-err">
                  Not delivered — the server rejected this message.
                </span>
              </ChatRowAnnotation>
            )}
            {commandId && (
              <ChatRowAnnotation align={align}>
                <CommandStatusChip entry={statuses.get(commandId)} deviceOnline={deviceOnline} />
              </ChatRowAnnotation>
            )}
          </>
        ),
      };
    },
    [pendingIds, failedIds, statuses, selfUserId, deviceOnline]
  );

  return (
    <MentionRosterProvider participants={roster}>
      <ChatThreadView
        workItemId={item.id}
        transcript={
          <TranscriptList
            items={items}
            workItemId={item.id}
            workspaceRoot={null}
            followKey={String(items.length)}
            onOpenArtifact={onOpenArtifact}
            checkpoints={null}
            header={
              <>
                {threadReveal.notFound && <RevealNotice onDismiss={threadReveal.dismissNotice} />}
                {feed.hasOlder && <LoadEarlierButton onClick={feed.loadOlder} />}
              </>
            }
            emptyLabel={feed.isSeeding ? 'Loading messages…' : 'No messages yet'}
            decorateEntry={decorateEntry}
            reveal={threadReveal.reveal}
            onRevealed={threadReveal.onRevealed}
          />
        }
        dock={
          <CloudApprovalCards
            sessionId={sessionId}
            agentName={agentLabel}
            approvals={capabilities.approvals}
            connected={composer.connected}
          />
        }
        composer={
          <ChatInput
            workItemId={item.id}
            participants={roster}
            mentionRoster={mentionRoster ?? undefined}
            mentionKinds={mentionKindsFor(capabilities)}
            agentLabel={agentLabel}
            untaggedAudience={composer.untaggedAudience}
            access={composer.access}
            onSend={composer.onSend}
            onDraftChange={composer.onDraftChange}
            onBlur={composer.onBlur}
            errorNotice={composer.errorNotice}
            ownerAgent={ownerAgent}
          />
        }
      />
    </MentionRosterProvider>
  );
}
