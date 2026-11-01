import { formatForDisplay } from '@tanstack/react-hotkeys';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import {
  ComposerActionRow,
  ComposerActionSpacer,
  ComposerDock,
  ComposerHintRow,
  ComposerSendButton,
  ComposerSurface,
} from '@renderer/lib/components/chrome/composer-shell';
import { useAutoGrow } from '@renderer/lib/hooks/use-auto-grow';
import { getEffectiveHotkey } from '@renderer/lib/hooks/useKeyboardShortcuts';
import { StepProgressBar } from './chat-input-pills';
import {
  resolveRoute,
  type ChatAudience,
  type ResolvedRoute,
  type RoutableParticipant,
} from './chat-routing';
import type { ComposerAccess } from './composer-access';
import { composerHint, composerPlaceholder } from './composer-text';
import { ComposerToolbar, type ComposerSettings } from './composer-toolbar';
import type { MentionPerson } from './mention-access';
import { MentionHighlightTextarea } from './mention-highlight-textarea';
import { MentionMenu, type MentionKind } from './mention-menu';
import { OwnerAgentPills, type OwnerAgent } from './owner-agent-pills';
import { SlashCommandMenu } from './slash-command-menu';
import { useMentionMenu } from './use-mention-menu';

/** The owner's agent controls: model, effort, mode, worktree, slash commands, stop. */
export interface AgentControls {
  sessionId: string;
  /** The session's agent — fixed at creation; another agent means another session. */
  agent: AgentProviderId;
  settings: ComposerSettings;
  /** Opens a new session with another installed agent. */
  onOpenAgent: (providerId: AgentProviderId) => void;
  /** Which of the work item's worktrees this draft goes into. */
  worktreeId?: string | null;
  /** Absent for a session tab already bound to one worktree: the pill shows read-only. */
  onWorktreeChange?: (worktreeId: string) => void;
  /** A turn is in flight — send becomes stop until it settles. */
  streaming?: boolean;
  onStop?: () => void;
  workflowStep?: { current: number; total: number; name: string } | null;
}

/**
 * The chat composer, owner's and teammate's alike (step 4, S5c): the draft,
 * its mentions, where Enter sends it and why it can't. What differs comes in
 * as props: `access` (one answer from the capabilities), the mention kinds
 * the viewer can open, and the owner's `agentControls`, absent for a viewer
 * who cannot configure the agent; such a viewer gets `ownerAgent` instead, the
 * owner's agent, model and mode shown disabled where the pickers would be.
 */
export function ChatInput({
  workItemId,
  participants,
  mentionRoster,
  mentionKinds,
  agentLabel,
  untaggedAudience,
  access,
  onSend,
  onDraftChange,
  onBlur,
  errorNotice,
  agentControls,
  ownerAgent,
}: {
  workItemId: string;
  /**
   * The work item's access roster. Owned by the chat surface (which also feeds
   * the transcript's mention pills from it) so one load serves both.
   */
  participants: readonly RoutableParticipant[];
  /** The @ roster (use-mention-roster.ts); without it the menu reads the people with access. */
  mentionRoster?: MentionPerson[];
  mentionKinds: ReadonlySet<MentionKind>;
  /** Display name for the mention menu's `@agent` row. */
  agentLabel: string;
  /** Where an untagged draft goes: the owner's wakes the agent; a teammate's follows the policy. */
  untaggedAudience: ChatAudience;
  access: ComposerAccess;
  /**
   * The resolved audience travels with the text — one resolution per send.
   * True once the message is out, and the draft clears; false keeps it.
   */
  onSend: (content: string, route: ResolvedRoute) => boolean | Promise<boolean>;
  /** Every change to the draft, its clearing after a send included. */
  onDraftChange: (draft: string) => void;
  onBlur?: () => void;
  /** A rejected send, shown until the draft changes. */
  errorNotice?: string | null;
  agentControls?: AgentControls;
  /** A teammate's composer: what the owner's chat runs, shown disabled. */
  ownerAgent?: OwnerAgent;
}) {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const { value: keyboard } = useAppSettingsKey('keyboard');
  const focusChatHotkey = getEffectiveHotkey('focusChat', keyboard);

  useAutoGrow(inputRef, value);

  const changeValue = useCallback(
    (next: string) => {
      setValue(next);
      // Editing is the retry gesture: the last refusal no longer describes the box.
      setRefusal(null);
      onDraftChange(next);
    },
    [onDraftChange]
  );

  const { mention, syncMention, closeMention, openMention, selectMention } = useMentionMenu({
    value,
    onValueChange: changeValue,
    inputRef,
    kinds: mentionKinds,
  });

  const route = useMemo(
    () => resolveRoute(value, participants, untaggedAudience),
    [value, participants, untaggedAudience]
  );
  const agentBlocked = route.audience === 'agent' && access.agentBlockedReason !== null;
  // The owner's every message wakes the thread's agent, so its label never
  // changes; a teammate's agent send is a separate act (a command), so it is named.
  const sendLabel = !agentControls && route.audience === 'agent' ? 'Send to agent' : 'Send';
  const streaming = agentControls?.streaming ?? false;

  const clearDraft = useCallback(() => {
    changeValue('');
    setSlashMenuOpen(false);
    closeMention();
  }, [changeValue, closeMention]);

  // Enter is gated on the same condition as the button. Without this the
  // button could swap to stop while the keyboard still queued a second
  // message into a turn that was already running. A message addressed to
  // teammates is exempt: it is not a prompt, so it cannot collide with the
  // running turn, and the agent picks it up from the thread digest on its
  // next wake.
  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || access.blockedReason || sending) return;
    if (agentBlocked) {
      setRefusal(access.agentBlockedReason);
      return;
    }
    if (streaming && route.audience !== 'thread') return;
    const sent = onSend(trimmed, route);
    if (typeof sent === 'boolean') {
      if (sent) clearDraft();
      return;
    }
    setSending(true);
    void sent
      .then((ok) => {
        if (ok) clearDraft();
      })
      .finally(() => setSending(false));
  }, [value, access, sending, agentBlocked, streaming, route, onSend, clearDraft]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const v = e.target.value;
      changeValue(v);
      if (agentControls) setSlashMenuOpen(v.startsWith('/') && !v.includes(' '));
      syncMention(v, e.target.selectionStart ?? v.length);
    },
    [changeValue, agentControls, syncMention]
  );

  const handleSlashSelect = useCallback(
    (command: string) => {
      changeValue(command + ' ');
      setSlashMenuOpen(false);
      inputRef.current?.focus();
    },
    [changeValue]
  );

  // Menus with matches consume Enter/Tab/arrows in their capture-phase
  // window listener (stopPropagation), so this only fires when no menu is
  // actually showing.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  /**
   * The `+` button is the mouse route to the composer's own `+files` trigger:
   * it inserts the trigger at the caret and opens the file menu, so picking a
   * file by clicking and by typing produce the same token. Attaching binary
   * uploads is a different feature — the agents read files from the worktree,
   * so a path reference is what they can actually act on.
   */
  const handleAddFileReference = useCallback(() => {
    const input = inputRef.current;
    const caret = input?.selectionStart ?? value.length;
    // A trigger only counts at the start of the input or after whitespace,
    // which is the same rule activeMentionAt applies when reading it back.
    const needsSpace = caret > 0 && !/\s$/.test(value.slice(0, caret));
    const insert = needsSpace ? ' +' : '+';
    const next = `${value.slice(0, caret)}${insert}${value.slice(caret)}`;
    const newCaret = caret + insert.length;
    changeValue(next);
    // Opened deliberately rather than inferred from the text: a click is an
    // unambiguous request for the file menu in a way a typed character is
    // not. `start` is the index of the trigger char itself.
    openMention({ kind: 'files', query: '', start: newCaret - 1 });
    input?.focus();
    requestAnimationFrame(() => input?.setSelectionRange(newCaret, newCaret));
  }, [value, changeValue, openMention]);

  const blockedBy = access.blockedReason ?? (agentBlocked ? access.agentBlockedReason : null);
  const shownError = errorNotice ?? refusal;
  const hint = composerHint({ error: shownError, notice: access.notice });
  const placeholder = composerPlaceholder({
    blockedReason: access.blockedReason,
    agentBlockedReason: access.agentBlockedReason,
    agentControls: !!agentControls,
  });

  return (
    <ComposerDock>
      {/*
       * Focus is tracked on the whole composer, not on the textarea.
       *
       * Clicking `+` (or any toolbar control) blurs the textarea, and when
       * that alone drove the state the composer collapsed on mousedown — which
       * unmounted the very button being clicked, so the file menu never
       * opened. `relatedTarget` is where focus is going: if that is still
       * inside the composer, the user has not left it.
       */}
      <div
        ref={composerRef}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
        }}
      >
        <ComposerSurface>
          {agentControls && (
            <SlashCommandMenu
              query={value}
              providerId={agentControls.agent}
              workItemId={workItemId}
              visible={slashMenuOpen}
              onSelect={handleSlashSelect}
              onClose={() => setSlashMenuOpen(false)}
              placement="above"
            />
          )}
          {mention && (
            <MentionMenu
              kind={mention.kind}
              query={mention.query}
              workItemId={workItemId}
              agentLabel={agentLabel}
              visible={!slashMenuOpen}
              onSelect={selectMention}
              onClose={closeMention}
              roster={mentionRoster}
            />
          )}
          {/* isFocusTarget keeps the stable `chord:focus-chat` hook (the focusChat
            shortcut and the palette) on this box. The focus hint sits in the
            input's top-right corner while the composer is idle. */}
          <div className="relative">
            <MentionHighlightTextarea
              textareaRef={inputRef}
              value={value}
              participants={participants}
              placeholder={placeholder}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onBlur={onBlur}
              disabled={access.blockedReason !== null}
              isFocusTarget
            />
            {!focused && !value && focusChatHotkey && !access.blockedReason && (
              <span className="pointer-events-none absolute right-0 top-0 text-tiny tracking-tiny text-text-passive">
                {formatForDisplay(focusChatHotkey)} to focus
              </span>
            )}
          </div>
          {/* An ended chat's composer is closed: the sentence alone, no
              pickers, + or send that would look like they still act. */}
          {access.ended ? null : agentControls ? (
            <ComposerToolbar
              workItemId={workItemId}
              controls={agentControls}
              composerRef={composerRef}
              onAddFileReference={handleAddFileReference}
              isAsideToTeammates={route.audience === 'thread'}
              onSend={handleSend}
              sendDisabled={!value.trim()}
              sendLabel={sendLabel}
            />
          ) : (
            <ComposerActionRow>
              {ownerAgent && <OwnerAgentPills owner={ownerAgent} />}
              <ComposerActionSpacer />
              <ComposerSendButton
                onClick={handleSend}
                disabled={!value.trim() || sending}
                blockedBy={blockedBy ?? undefined}
                ariaLabel={sendLabel}
                title={sendLabel}
              />
            </ComposerActionRow>
          )}
        </ComposerSurface>
      </div>
      {(hint || agentControls?.workflowStep) && (
        <ComposerHintRow>
          {hint && (
            <span
              className={`flex-1 text-micro tracking-micro ${shownError ? 'text-status-err' : 'text-text-passive'}`}
            >
              {hint}
            </span>
          )}
          {agentControls?.workflowStep && (
            <StepProgressBar
              currentStep={agentControls.workflowStep.current}
              totalSteps={agentControls.workflowStep.total}
              stepName={agentControls.workflowStep.name}
            />
          )}
        </ComposerHintRow>
      )}
    </ComposerDock>
  );
}
