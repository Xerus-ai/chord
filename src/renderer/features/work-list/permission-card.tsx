import { Plug } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  AgentCard,
  AgentCardActions,
  AgentCardCommand,
  AgentCardGhostButton,
  AgentCardHeader,
  AgentCardOutlineButton,
  AgentCardOverview,
  AgentCardPrimaryButton,
} from '@renderer/lib/components/chrome/agent-card';
import { useModalStore } from '@renderer/lib/modal/modal-store';
import { APPROVAL_NOTICE, type ApprovalAnswer } from './approval-answer';
import type { PermissionOptionData } from './chat-types';

interface PermissionCardProps {
  /** The agent asking: the work item's provider, named rather than assumed. */
  agentName: string;
  toolName: string;
  /** What the agent says the call does, when it says. */
  title?: string;
  command?: string;
  options: PermissionOptionData[];
  answer: ApprovalAnswer;
  /**
   * Sends the answer: the owner's through ACP, a teammate's as a command.
   * Resolves once it is out; the container then drops the card (the owner
   * dismisses it, a teammate's clears when the request resolves). Rejects with
   * the reason to show, and the card stays live, since the agent still waits.
   */
  onAnswer: (option: PermissionOptionData) => Promise<void>;
}

/** A permission request the agent is blocked on, the same card for owner and teammate. */
export function PermissionCard({
  agentName,
  toolName,
  title,
  command,
  options,
  answer,
  onAnswer,
}: PermissionCardProps) {
  const [responding, setResponding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canAnswer = answer === 'answer';

  const handleOption = useCallback(
    (option: PermissionOptionData) => {
      if (responding || !canAnswer) return;
      setResponding(true);
      setError(null);
      onAnswer(option).catch((e: unknown) => {
        setResponding(false);
        setError(e instanceof Error ? e.message : String(e));
      });
    },
    [responding, canAnswer, onAnswer]
  );

  const denyOption = options.find((o) => o.kind.startsWith('reject'));
  const allowAlwaysOption = options.find((o) => o.kind === 'allow_always');
  const allowOnceOption = options.find((o) => o.kind === 'allow_once');

  // The card advertises "esc" next to Deny. At most one permission card is
  // answerable in a chat at a time, so a window listener is the whole binding.
  // Escape is also the `closeModal` binding. While a modal is open that is
  // what the key means, and one press must not both dismiss the dialog and
  // deny the agent — an answer the user never saw themselves give.
  const modalOpen = useModalStore((s) => s.isOpen);
  useEffect(() => {
    if (!canAnswer || !denyOption || modalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Escape inside a field is that field's own dismiss (the composer's
      // commit prompt, the mention menu) — denying the agent's request is not
      // what the user meant there.
      const target = e.target as HTMLElement | null;
      if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '')) {
        return;
      }
      e.preventDefault();
      handleOption(denyOption);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canAnswer, denyOption, modalOpen, handleOption]);

  return (
    <AgentCard>
      <AgentCardHeader
        icon={Plug}
        title={
          <>
            Allow {agentName} to run <span className="font-mono">{toolName}</span>?
          </>
        }
      />
      {title && <AgentCardOverview>{title}</AgentCardOverview>}

      {command && <AgentCardCommand>{command}</AgentCardCommand>}

      {!canAnswer && (
        <p className="mx-[14px] mb-3 text-tiny tracking-tiny text-text-passive">
          {APPROVAL_NOTICE[answer]}
        </p>
      )}

      {error && (
        <p className="mx-[14px] mb-3 rounded-[var(--radius-sm)] border border-border px-3 py-2 text-tiny tracking-tiny text-status-err">
          {error}
        </p>
      )}

      {/* The hint belongs to the binding, not to the card: it used to render
          even when there was no deny option, advertising a key that did
          nothing. */}
      {canAnswer && (
        <AgentCardActions hint={denyOption ? 'esc to deny' : undefined}>
          {denyOption && (
            <AgentCardGhostButton onClick={() => handleOption(denyOption)} disabled={responding}>
              Deny
            </AgentCardGhostButton>
          )}
          {allowAlwaysOption && (
            <AgentCardOutlineButton
              onClick={() => handleOption(allowAlwaysOption)}
              disabled={responding}
            >
              {allowAlwaysOption.name}
            </AgentCardOutlineButton>
          )}
          {allowOnceOption && (
            <AgentCardPrimaryButton
              onClick={() => handleOption(allowOnceOption)}
              disabled={responding}
            >
              Allow once
            </AgentCardPrimaryButton>
          )}
        </AgentCardActions>
      )}
    </AgentCard>
  );
}
