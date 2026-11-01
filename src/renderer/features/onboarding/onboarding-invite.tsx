import { Loader2, Mail } from 'lucide-react';
import { useCallback, useState } from 'react';
import { cloudTeamApi } from '@renderer/lib/cloud-team-api';
import { useAccountSession } from '@renderer/lib/hooks/useAccount';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { OnboardingSection, RowTile, SectionFooter, SectionRow } from './onboarding-section';

/**
 * Sends the same organisation invitation the Team settings tab sends
 * (`cloudTeamApi.inviteToOrg`), so an invite from onboarding shows up in the same
 * pending list. Optional: it never counts toward what is left.
 */
export function OnboardingInviteSection({
  index,
  isNext,
  onInvited,
}: {
  index: number;
  isNext: boolean;
  onInvited: () => void;
}) {
  const { data: session } = useAccountSession();
  const orgId = (session?.user as { orgId?: string | null } | undefined)?.orgId ?? null;

  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleInvite = useCallback(async () => {
    const trimmed = email.trim();
    if (!trimmed || !orgId) return;

    setSending(true);
    setError(null);
    try {
      await cloudTeamApi.inviteToOrg(orgId, trimmed);
      setSent((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
      setEmail('');
      onInvited();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send invite');
    } finally {
      setSending(false);
    }
  }, [email, orgId, onInvited]);

  return (
    <OnboardingSection
      index={index}
      isNext={isNext}
      title="Invite your team"
      meta={{ kind: 'label', label: 'Optional' }}
      description="Teammates see your work items as they run and can pick up where your agent left off."
      state={error ? 'error' : sent.length > 0 ? 'done' : 'todo'}
      answer={
        sent.length > 0 && (
          <>
            <span className="font-medium text-text-muted">{sent.length}</span> invited
          </>
        )
      }
      footer={
        error ? (
          <SectionFooter tone="error">{error}</SectionFooter>
        ) : !orgId ? (
          <SectionFooter>
            Your account isn't part of a team yet, so there's nobody to invite.
          </SectionFooter>
        ) : undefined
      }
    >
      <SectionRow
        label="Invite by email"
        detail="They join your workspace."
        control={
          <div className="flex w-75 items-center gap-1.5">
            <div className="relative min-w-0 flex-1">
              <Mail className="pointer-events-none absolute top-1/2 left-2.5 size-icon-xs -translate-y-1/2 text-text-passive" />
              <Input
                type="email"
                aria-label="Teammate email"
                placeholder="name@company.com"
                value={email}
                disabled={!orgId || sending}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleInvite();
                  }
                }}
                className="bg-surface-inset pl-7.5"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleInvite()}
              disabled={!orgId || !email.trim() || sending}
            >
              {sending && <Loader2 className="animate-spin" />}
              Invite
            </Button>
          </div>
        }
      />
      {sent.map((address) => (
        <SectionRow
          key={address}
          className="min-h-11"
          leading={
            <RowTile className="size-6 rounded-full text-tiny font-semibold">
              {address.charAt(0).toUpperCase()}
            </RowTile>
          }
          label={<span className="font-normal">{address}</span>}
          control={<span className="text-tiny tracking-tiny text-text-passive">Invited</span>}
        />
      ))}
    </OnboardingSection>
  );
}
