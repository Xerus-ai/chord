import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Inbox, LogIn, LogOut, Mail, Shield, Trash2, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { InviteTeammateForm } from '@renderer/features/dashboard/invite-section';
import { MemberAvatar } from '@renderer/features/dashboard/member-avatar';
import { cloudTeamApi, type OrgInvite, type OrgMember } from '@renderer/lib/cloud-team-api';
import { LoadErrorNotice } from '@renderer/lib/components/load-error-notice';
import { MY_INVITES_KEY, useInviteActions } from '@renderer/lib/hooks/use-invite-actions';
import {
  ACCOUNT_SESSION_KEY,
  useAccountSession,
  useAccountSignIn,
} from '@renderer/lib/hooks/useAccount';
import { Button } from '@renderer/lib/ui/button';
import { ORG_SUBSCRIPTION_KEY, TeamBillingCard } from './TeamBillingCard';
import { WorkspaceNameCard } from './WorkspaceNameCard';

export function TeamSettingsTab() {
  const { data: session } = useAccountSession();
  const signIn = useAccountSignIn();
  const orgId = (session?.user as { orgId?: string | null } | undefined)?.orgId ?? null;
  const selfUserId = (session?.user as { userId?: string } | undefined)?.userId ?? null;

  // Every fetch on this tab 401s while the session is expired, so one calm
  // state with the fix replaces two red boxes whose Retry can only fail.
  if (session?.authState === 'reauth_required') {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-border/60 bg-surface-raised p-4 text-center text-body tracking-body text-text-passive">
        Sign in again to see your workspace and team.
        <Button
          type="button"
          className="w-fit"
          onClick={() => signIn.mutate()}
          disabled={signIn.isPending}
        >
          <LogIn className="h-3.5 w-3.5" />
          {signIn.isPending ? 'Signing in...' : 'Sign in'}
        </Button>
      </div>
    );
  }

  if (!session?.isSignedIn) {
    return (
      <div className="rounded-lg border border-border/60 bg-surface-raised p-4 text-center text-body tracking-body text-text-passive">
        Sign in to manage your team.
      </div>
    );
  }

  // The invitations card sits above everything and shows even in a solo
  // workspace (or with no org at all): an invite addressed to you is not
  // scoped to the org you're currently in.
  return (
    <div className="space-y-6">
      <MyInvitesCard />
      {!orgId ? (
        <div className="rounded-lg border border-border/60 bg-surface-raised p-4 text-center text-body tracking-body text-text-passive">
          No organization found. Create or join a team to get started.
        </div>
      ) : (
        <>
          <WorkspaceNameCard orgId={orgId} />
          <TeamSettingsContent orgId={orgId} selfUserId={selfUserId} />
        </>
      )}
    </div>
  );
}

// Pending invites addressed TO the current user. Empty → renders nothing.
function MyInvitesCard() {
  const { accept, decline } = useInviteActions();
  const { data: invites } = useQuery({
    queryKey: [...MY_INVITES_KEY],
    queryFn: () => cloudTeamApi.getMyInvites(),
  });

  if (!invites || invites.length === 0) return null;

  return (
    <div className="space-y-1">
      <h4 className="text-tiny tracking-tiny font-medium text-text-passive">Invitations to you</h4>
      {invites.map((inv) => {
        const acceptPending = accept.isPending && accept.variables === inv.id;
        const declinePending = decline.isPending && decline.variables === inv.id;
        const busy = acceptPending || declinePending;
        return (
          <div
            key={inv.id}
            className="flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2"
          >
            <Inbox className="h-4 w-4 shrink-0 text-text-passive" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-body tracking-body text-text">
                {inv.org_name} invited you
              </div>
              <div className="truncate text-tiny tracking-tiny text-text-passive">
                as {inv.role}
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                className="h-7 px-2 text-tiny tracking-tiny"
                disabled={busy}
                onClick={() => accept.mutate(inv.id)}
              >
                {acceptPending ? 'Accepting…' : 'Accept'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="h-7 px-2 text-tiny tracking-tiny"
                disabled={busy}
                onClick={() => decline.mutate(inv.id)}
              >
                {declinePending ? 'Declining…' : 'Decline'}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TeamSettingsContent({ orgId, selfUserId }: { orgId: string; selfUserId: string | null }) {
  const queryClient = useQueryClient();
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [invites, setInvites] = useState<OrgInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Row id currently mutating (member user_id, invite id, or '__leave__') so
  // only the acted-on control shows a busy/disabled state.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [m, i] = await Promise.all([
        cloudTeamApi.getOrgMembers(orgId),
        cloudTeamApi.getOrgInvites(orgId),
      ]);
      setMembers(m);
      setInvites(i.filter((inv) => inv.status === 'pending'));
      // Members and pending invites ARE the seat count — keep the billing
      // card's number in step with the list it sits above.
      void queryClient.invalidateQueries({ queryKey: ORG_SUBSCRIPTION_KEY(orgId) });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load team');
    } finally {
      setLoading(false);
    }
  }, [orgId, queryClient]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const isOwner = members.find((m) => m.user_id === selfUserId)?.role === 'owner';

  const removeMember = useCallback(
    async (userId: string) => {
      setBusyId(userId);
      setActionError(null);
      try {
        await cloudTeamApi.removeMember(orgId, userId);
        await fetchData();
        void queryClient.invalidateQueries({ queryKey: ['organizations', 'memberships'] });
      } catch (e) {
        setActionError(e instanceof Error ? e.message : 'Failed to remove member');
      } finally {
        setBusyId(null);
      }
    },
    [orgId, fetchData, queryClient]
  );

  const revokeInvite = useCallback(
    async (inviteId: string) => {
      setBusyId(inviteId);
      setActionError(null);
      try {
        await cloudTeamApi.revokeInvite(orgId, inviteId);
        await fetchData();
      } catch (e) {
        setActionError(e instanceof Error ? e.message : 'Failed to revoke invite');
      } finally {
        setBusyId(null);
      }
    },
    [orgId, fetchData]
  );

  const leaveOrg = useCallback(async () => {
    setBusyId('__leave__');
    setActionError(null);
    try {
      await cloudTeamApi.leaveOrg(orgId);
      void queryClient.invalidateQueries({ queryKey: ['organizations', 'memberships'] });
      void queryClient.invalidateQueries({ queryKey: [...ACCOUNT_SESSION_KEY] });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to leave workspace');
    } finally {
      setBusyId(null);
    }
  }, [orgId, queryClient]);

  if (loading) {
    return (
      <div className="rounded-lg border border-border/60 bg-surface-raised p-4 text-center text-body tracking-body text-text-passive">
        Loading team...
      </div>
    );
  }

  if (loadError) {
    return (
      <LoadErrorNotice
        title="Couldn't load your team"
        message={loadError}
        onRetry={() => void fetchData()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <TeamBillingCard orgId={orgId} />
      {actionError && <p className="text-tiny tracking-tiny text-status-err">{actionError}</p>}
      <MemberList
        members={members}
        selfUserId={selfUserId}
        isOwner={isOwner}
        busyId={busyId}
        onRemove={removeMember}
      />
      {isOwner && (
        <InviteTeammateForm
          orgId={orgId}
          onInviteSent={fetchData}
          header={
            <div className="flex items-center gap-2 text-body tracking-body font-medium text-text">
              <UserPlus className="h-4 w-4" />
              Invite a teammate
            </div>
          }
        />
      )}
      {invites.length > 0 && (
        <PendingInvites
          invites={invites}
          isOwner={isOwner}
          busyId={busyId}
          onRevoke={revokeInvite}
        />
      )}
      {!isOwner && (
        <div className="pt-2">
          <Button
            type="button"
            variant="ghost"
            className="text-text-passive"
            disabled={busyId === '__leave__'}
            onClick={() => void leaveOrg()}
          >
            <LogOut className="h-3.5 w-3.5" />
            {busyId === '__leave__' ? 'Leaving…' : 'Leave workspace'}
          </Button>
        </div>
      )}
    </div>
  );
}

function MemberList({
  members,
  selfUserId,
  isOwner,
  busyId,
  onRemove,
}: {
  members: OrgMember[];
  selfUserId: string | null;
  isOwner: boolean;
  busyId: string | null;
  onRemove: (userId: string) => void;
}) {
  if (members.length === 0) {
    return (
      <div className="rounded-lg border border-border/60 bg-surface-raised p-4 text-center text-body tracking-body text-text-passive">
        No team members yet.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {members.map((member) => {
        // The owner can remove anyone except the owner (themselves). Members
        // never see remove controls.
        const canRemove = isOwner && member.user_id !== selfUserId && member.role !== 'owner';
        return (
          <div
            key={member.user_id}
            className="flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2"
          >
            <MemberAvatar
              name={member.name ?? member.email}
              avatarUrl={member.avatar_url}
              size="md"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-body tracking-body text-text">
                {member.name ?? member.email.split('@')[0]}
              </div>
              <div className="truncate text-tiny tracking-tiny text-text-passive">
                {member.email}
              </div>
            </div>
            <div className="flex items-center gap-1 text-tiny tracking-tiny text-text-passive">
              <Shield className="h-3 w-3" />
              {member.role}
            </div>
            {canRemove && (
              <Button
                type="button"
                variant="ghost"
                className="h-7 w-7 p-0 text-text-passive"
                aria-label={`Remove ${member.email}`}
                disabled={busyId === member.user_id}
                onClick={() => onRemove(member.user_id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PendingInvites({
  invites,
  isOwner,
  busyId,
  onRevoke,
}: {
  invites: OrgInvite[];
  isOwner: boolean;
  busyId: string | null;
  onRevoke: (inviteId: string) => void;
}) {
  return (
    <div className="space-y-1">
      <h4 className="text-tiny tracking-tiny font-medium text-text-passive">Pending invites</h4>
      {invites.map((invite) => (
        <div
          key={invite.id}
          className="flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2"
        >
          <Mail className="h-4 w-4 shrink-0 text-text-passive" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-body tracking-body text-text">{invite.email}</div>
          </div>
          <div className="flex items-center gap-1 text-tiny tracking-tiny text-text-passive">
            <Clock className="h-3 w-3" />
            {invite.role}
          </div>
          {isOwner && (
            <Button
              type="button"
              variant="ghost"
              className="h-7 px-2 text-tiny tracking-tiny text-text-passive"
              disabled={busyId === invite.id}
              onClick={() => onRevoke(invite.id)}
            >
              {busyId === invite.id ? 'Revoking…' : 'Revoke'}
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
