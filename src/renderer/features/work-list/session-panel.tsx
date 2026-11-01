import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { isValidProviderId, type AgentProviderId } from '@shared/agent-provider-registry';
import { getProvider } from '@shared/agent-providers';
import type { AgentSessionRow } from '@main/db/schema-work-items';
import { useWatchArtifactSourceDrift } from '@renderer/features/artifacts/use-artifact-source-drift';
import { invalidateWorkItemArtifacts } from '@renderer/features/artifacts/use-work-item-artifacts';
import { useLocalSharingAvailabilityOf } from '@renderer/features/sharing/use-local-sharing-availability';
import { StateCard } from '@renderer/lib/components/state-card';
import { toast } from '@renderer/lib/hooks/use-toast';
import { useWorkItems } from '@renderer/lib/hooks/use-work-items';
import { rpc } from '@renderer/lib/ipc';
import { artifactPathTab, type StripTab } from './center-tab';
import { openCenterTab, type OpenTabOptions } from './center-tabs-store';
import { ChatInput } from './chat-input';
import type { ResolvedRoute } from './chat-routing';
import { ChatThreadView } from './chat-thread-view';
import { mentionKindsFor, resolveComposerAccess } from './composer-access';
import { describeRpcFailure, describeThrownFailure } from './describe-action-failure';
import { selectLatestTurn } from './latest-turn';
import { answerLocalPermission } from './local-approvals';
import { MentionRosterProvider } from './mention-roster';
import { MentionShareBar } from './mention-share-bar';
import type { MessageRevealRequest } from './message-reveal-request';
import { PermissionCard } from './permission-card';
import { QuestionCard } from './question-card';
import { RevealNotice } from './reveal-notice';
import { SendErrorStrip } from './send-error-strip';
import { findSessionWorktree } from './session-tab-model';
import { SubagentDock } from './subagent-dock';
import { TranscriptList } from './transcript-list';
import {
  buildSessionTranscript,
  selectPendingPermission,
  selectPendingQuestion,
  selectRunningSubagents,
} from './transcript-rows';
import { useAgentTurns } from './turn-stream-context';
import { useChatSend } from './use-chat-send';
import { useComposerSettings } from './use-composer-settings';
import { useMentionRoster } from './use-mention-roster';
import { useMentionShare } from './use-mention-share';
import { useParticipants } from './use-participants';
import { useSessionChatMessages } from './use-session-chat-messages';
import { useThreadReveal } from './use-thread-reveal';
import { useTurnHistory } from './use-turn-history';
import { useTypingSender } from './use-typing-indicators';
import { useWorkItemWorktrees } from './use-work-item-worktrees';
import { useWorkItemSource } from './work-item-source';
import { WorkItemTerminal } from './work-item-terminal';

/**
 * A running session's agent is fixed, so the composer's other-agent choice
 * starts a new chat session with that agent in the same worktree and brings
 * its tab forward.
 */
function useOpenAgentSession(workItemId: string, worktreeId: string | null) {
  return useCallback(
    (providerId: AgentProviderId) => {
      rpc.agentSessions
        .create({
          workItemId,
          kind: 'chat',
          agentProviderId: providerId,
          worktreeId: worktreeId ?? undefined,
        })
        .then((result) => {
          if (!result.success) throw new Error(describeRpcFailure('Create chat', result.error));
          window.dispatchEvent(
            new CustomEvent('chord:switch-tab', {
              detail: { kind: 'session', sessionId: result.data.session.id },
            })
          );
        })
        .catch((error: unknown) => {
          toast({
            title: 'Could not start the session',
            description: describeThrownFailure('Create chat', error),
            variant: 'destructive',
          });
        });
    },
    [workItemId, worktreeId]
  );
}

/** Stops this one session — the whole-item stop lives on the Room composer. */
function useStopSession(workItemId: string, sessionId: string) {
  return useCallback(() => {
    rpc.chatMessages.stopAgent(workItemId, { sessionId }).catch((error: unknown) => {
      toast({
        title: 'Could not stop the agent',
        description: describeThrownFailure('Stop agent', error),
        variant: 'destructive',
      });
    });
  }, [workItemId, sessionId]);
}

/**
 * The owner's transcript parts: artifact chips open in the owner's layout
 * (refetching the local list, so a fresh artifact's tab is never judged
 * deleted), turn checkpoints, and the drift watcher, which measures artifacts
 * against files on this machine.
 */
function useLocalTranscriptSource(workItemId: string, workspaceRoot: string | null) {
  const queryClient = useQueryClient();
  const { layoutKey } = useWorkItemSource();
  const checkpoints = useTurnHistory(workItemId);
  useWatchArtifactSourceDrift(workspaceRoot ? workItemId : null);
  const onOpenArtifact = useCallback(
    (artifactId: string, title: string, options?: OpenTabOptions) => {
      openCenterTab(layoutKey, artifactPathTab(artifactId, title), options);
      void invalidateWorkItemArtifacts(queryClient, workItemId);
    },
    [queryClient, layoutKey, workItemId]
  );
  return { onOpenArtifact, checkpoints };
}

/** The owner's chat thread: this machine's rows and turn stream, and the full composer. */
function LocalChatThread({
  session,
  provider,
}: {
  session: AgentSessionRow;
  provider: AgentProviderId;
}) {
  const workItemId = session.workItemId;
  const { capabilities, layoutKey } = useWorkItemSource();
  const { entries, seeded, mergeCloudRows } = useSessionChatMessages(workItemId, session.id);
  const { turns, seedError: turnsError } = useAgentTurns(session.id);
  const { participants } = useParticipants(workItemId);
  const worktrees = useWorkItemWorktrees(workItemId);
  const { items: workItems } = useWorkItems();
  const stopSession = useStopSession(workItemId, session.id);
  const send = useChatSend(workItemId);
  const [dismissedPermissionId, setDismissedPermissionId] = useState<string | null>(null);

  const items = useMemo(() => buildSessionTranscript(entries, turns), [entries, turns]);
  // A notification's message (step 5): local history holds it, or the cloud
  // row the reveal read is added here.
  const revealTab = useMemo<StripTab>(
    () => ({ kind: 'session', sessionId: session.id }),
    [session.id]
  );
  const ensureLoaded = useCallback(
    (request: MessageRevealRequest) => {
      if (request.row) mergeCloudRows([request.row]);
      return Promise.resolve(true);
    },
    [mergeCloudRows]
  );
  const threadReveal = useThreadReveal({
    layoutKey,
    tab: revealTab,
    items,
    ready: seeded,
    ensureLoaded,
  });
  const latestTurn = useMemo(() => selectLatestTurn(turns), [turns]);
  const pendingPermission = selectPendingPermission(latestTurn, dismissedPermissionId);
  const pendingQuestion = selectPendingQuestion(latestTurn);
  const runningSubagents = useMemo(() => selectRunningSubagents(turns), [turns]);
  const turnActivity = `${turns.length}:${latestTurn?.id ?? ''}:${latestTurn?.status ?? ''}`;

  const workItem = workItems.find((w) => w.id === workItemId);
  const settings = useComposerSettings({
    workItemId,
    sessionId: session.id,
    initialEffort: workItem?.effort ?? null,
    initialModel: workItem?.model ?? null,
  });
  const openAgentSession = useOpenAgentSession(workItemId, session.worktreeId);

  const { releaseSending, sendToAgent, postToThread, notifyMentions } = send;
  useEffect(() => releaseSending(), [turnActivity, releaseSending]);

  // The tab fixes the thread: whatever the draft mentions, it lands in this
  // session. Only a message for the agent starts a turn; one addressed to
  // people alone is chat, which the agent reads on its next turn. People
  // mentioned are notified once it is saved.
  const dispatchSend = useCallback(
    (content: string, route: ResolvedRoute) => {
      const saved =
        route.audience === 'thread'
          ? postToThread(content, session.id)
          : sendToAgent(content, session.id);
      void saved.then((messageId) => {
        if (messageId) notifyMentions(content, route, messageId);
      });
    },
    [session.id, sendToAgent, postToThread, notifyMentions]
  );
  // Mentioning someone who cannot see the item asks first (use-mention-share.ts).
  const availabilityOf = useLocalSharingAvailabilityOf();
  const mentionRoster = useMentionRoster({
    workItemId,
    viewer: 'owner',
    participants,
    enabled: !!workItem && availabilityOf(workItem).kind === 'available',
  });
  const mentionShare = useMentionShare({ workItemId, roster: mentionRoster, send: dispatchSend });
  const roster = mentionRoster ?? participants;
  const ended = session.status === 'done';
  const access = useMemo(
    () => resolveComposerAccess({ capabilities, connection: 'local', deviceOnline: true, ended }),
    [capabilities, ended]
  );
  const handleSend = useCallback(
    (content: string, route: ResolvedRoute) => {
      mentionShare.handleSend(content, route);
      return true;
    },
    [mentionShare]
  );

  // Typing reaches the room only when someone else can see the item; an
  // unshared item has no room, and the server would refuse every event.
  const sendTyping = useTypingSender(workItemId);
  const hasTeammates = participants.length > 1;
  const handleDraftChange = useCallback(
    (draft: string) => {
      if (hasTeammates) sendTyping(draft.length > 0);
    },
    [hasTeammates, sendTyping]
  );

  const lastItemCount = latestTurn?.items.length ?? 0;
  const workspaceRoot = findSessionWorktree(worktrees, session.worktreeId)?.path ?? null;
  const transcriptSource = useLocalTranscriptSource(workItemId, workspaceRoot);

  return (
    <MentionRosterProvider participants={roster}>
      <ChatThreadView
        workItemId={workItemId}
        transcript={
          <TranscriptList
            items={items}
            workItemId={workItemId}
            workspaceRoot={workspaceRoot}
            followKey={`${items.length}:${lastItemCount}`}
            onOpenArtifact={transcriptSource.onOpenArtifact}
            checkpoints={transcriptSource.checkpoints}
            header={
              threadReveal.notFound ? <RevealNotice onDismiss={threadReveal.dismissNotice} /> : null
            }
            reveal={threadReveal.reveal}
            onRevealed={threadReveal.onRevealed}
          />
        }
        dock={
          <>
            <SubagentDock
              agents={runningSubagents}
              onStopAll={capabilities.stopAgent ? stopSession : undefined}
            />
            {turnsError && (
              <div
                role="alert"
                className="border-t border-border-subtle bg-surface px-5 py-2 text-tiny tracking-tiny text-status-err"
              >
                {turnsError}
              </div>
            )}
            {(send.sendError || pendingPermission || pendingQuestion) && (
              <div className="flex shrink-0 flex-col gap-3 border-t border-border-subtle bg-surface px-5 py-3">
                {send.sendError && (
                  <SendErrorStrip message={send.sendError} onDismiss={send.dismissError} />
                )}
                {pendingPermission && (
                  <PermissionCard
                    key={pendingPermission.id}
                    agentName={getProvider(provider)?.name ?? provider}
                    toolName={pendingPermission.name}
                    title={pendingPermission.title}
                    command={pendingPermission.command}
                    options={pendingPermission.options}
                    answer="answer"
                    onAnswer={(option) =>
                      answerLocalPermission(
                        workItemId,
                        pendingPermission.requestId,
                        option.optionId
                      ).then(() => setDismissedPermissionId(pendingPermission.id))
                    }
                  />
                )}
                {pendingQuestion && (
                  <QuestionCard
                    key={pendingQuestion.id}
                    workItemId={workItemId}
                    requestId={pendingQuestion.requestId}
                    agentProvider={provider}
                    questions={pendingQuestion.questions}
                  />
                )}
              </div>
            )}
          </>
        }
        composer={
          <>
            {mentionShare.pending && (
              <MentionShareBar
                people={mentionShare.pending.people}
                busy={mentionShare.busy}
                error={mentionShare.error}
                onChoose={(choice) => void mentionShare.choose(choice)}
                onCancel={mentionShare.cancel}
              />
            )}
            <ChatInput
              workItemId={workItemId}
              participants={roster}
              mentionRoster={mentionRoster ?? undefined}
              mentionKinds={mentionKindsFor(capabilities)}
              agentLabel={getProvider(provider)?.name ?? 'Agent'}
              untaggedAudience="agent"
              access={access}
              onSend={handleSend}
              onDraftChange={handleDraftChange}
              onBlur={() => handleDraftChange('')}
              agentControls={
                capabilities.configureAgent
                  ? {
                      sessionId: session.id,
                      agent: provider,
                      settings,
                      onOpenAgent: openAgentSession,
                      // Read-only: the session is bound to its worktree.
                      worktreeId: session.worktreeId,
                      streaming: send.sending || latestTurn?.status === 'streaming',
                      onStop: capabilities.stopAgent ? stopSession : undefined,
                    }
                  : undefined
              }
            />
          </>
        }
      />
    </MentionRosterProvider>
  );
}

/**
 * One agent session's tab body. A terminal session is its PTY; a chat session
 * is its own transcript — the prompts it received and the turns it produced —
 * with a composer that always sends to this session.
 *
 * Chat sessions must be rendered inside a `TurnStreamProvider` and the view's
 * `WorkItemSourceProvider` for the work item.
 */
export function SessionPanel({ session }: { session: AgentSessionRow }) {
  if (session.kind === 'terminal') {
    return <WorkItemTerminal key={session.id} sessionId={session.id} />;
  }
  if (!isValidProviderId(session.agentProviderId)) {
    return (
      <StateCard
        badge="Error"
        tone="error"
        title="Unknown agent for this session"
        description={`This session was started with "${session.agentProviderId ?? 'no agent'}", which this version of Chord does not recognise.`}
      />
    );
  }
  return <LocalChatThread key={session.id} session={session} provider={session.agentProviderId} />;
}
