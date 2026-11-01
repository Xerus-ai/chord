import { Check, Send } from 'lucide-react';
import React, { useCallback, useState, type ReactNode } from 'react';
import { cloudTeamApi } from '@renderer/lib/cloud-team-api';

/**
 * The invite-a-teammate card: email input, send button, and result state.
 * The surrounding heading differs per surface, so callers pass it in.
 */
export function InviteTeammateForm({
  orgId,
  header,
  onInviteSent,
  onInputMount,
}: {
  orgId: string | null;
  header: ReactNode;
  onInviteSent?: () => void;
  onInputMount?: (el: HTMLInputElement | null) => void;
}) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleInvite = useCallback(async () => {
    const trimmed = email.trim();
    if (!trimmed || !orgId) return;

    setStatus('sending');
    setErrorMsg('');
    try {
      await cloudTeamApi.inviteToOrg(orgId, trimmed);
      setStatus('sent');
      setEmail('');
      onInviteSent?.();
      setTimeout(() => setStatus('idle'), 3000);
    } catch (e) {
      setStatus('error');
      setErrorMsg(e instanceof Error ? e.message : 'Failed to send invite');
      setTimeout(() => setStatus('idle'), 3000);
    }
  }, [email, orgId, onInviteSent]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void handleInvite();
      }
    },
    [handleInvite]
  );

  return (
    <div className="rounded-lg border border-action-bg/[0.15] bg-action-bg/[0.05] p-4">
      {header}
      <div className="mt-3 flex gap-2">
        <input
          ref={onInputMount}
          data-invite-input
          type="email"
          placeholder="teammate@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={status === 'sending'}
          className="flex-1 rounded-md border border-border bg-surface-inset px-3 py-2 text-body tracking-body text-text outline-none transition-colors placeholder:text-text-passive focus:border-border-strong disabled:bg-action-bg-disabled disabled:text-action-fg-disabled"
        />
        <button
          type="button"
          onClick={() => void handleInvite()}
          disabled={!email.trim() || !orgId || status === 'sending'}
          className="flex items-center gap-1 rounded-md bg-action-bg px-3 py-2 text-tiny tracking-tiny font-semibold text-action-fg transition-colors hover:bg-action-bg-hover disabled:bg-action-bg-disabled disabled:text-action-fg-disabled"
        >
          {status === 'sent' ? (
            <>
              <Check className="h-3 w-3" />
              Sent
            </>
          ) : (
            <>
              <Send className="h-3 w-3" />
              Invite
            </>
          )}
        </button>
      </div>
      {status === 'error' && errorMsg && (
        <p className="mt-2 text-tiny tracking-tiny text-status-err">{errorMsg}</p>
      )}
    </div>
  );
}

/** Dashboard-sidebar framing around the invite form. */
export function InviteSection({
  orgId,
  onMount,
}: {
  orgId: string | null;
  onMount?: (el: HTMLInputElement | null) => void;
}) {
  return (
    <div className="p-5">
      <h3 className="mb-4 section-header">Your Team</h3>
      <InviteTeammateForm
        orgId={orgId}
        onInputMount={onMount}
        header={
          <>
            <p className="text-body tracking-body font-semibold text-text">
              Chord is better together
            </p>
            <p className="mt-1 text-tiny tracking-tiny leading-relaxed text-text-passive">
              Invite your team to share sessions, review plans, and build together in real time.
            </p>
          </>
        }
      />
    </div>
  );
}
