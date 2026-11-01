import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { cloudTeamApi } from '@renderer/lib/cloud-team-api';
import { AgentDrivingToggle } from './agent-driving-toggle';
import { ShareGeneralAccess } from './share-general-access';
import { ShareInvitePicker } from './share-invite-picker';
import { SharePeopleList } from './share-people-list';
import { sharePeopleRows } from './share-people-rows';
import type { ShareScope } from './share-scope';
import { useSharing } from './use-sharing';

/**
 * The Share tab for one scope (the whole work item, or one artifact):
 * invite from the team, the people with access, and general access. Only
 * the author manages; the dialog is the author's.
 */
export function SharePeopleTab({
  workItemId,
  scope,
  onOpenArtifact,
}: {
  workItemId: string;
  scope: ShareScope;
  onOpenArtifact: (artifactId: string) => void;
}) {
  const sharing = useSharing(
    scope.kind === 'artifact' ? { workItemId, artifactId: scope.artifactId } : { workItemId }
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const reportError = useCallback((message: string) => setActionError(message), []);
  const state = sharing.state;
  const isAuthor = state?.caller_role === 'author';
  const roster = useQuery({
    queryKey: ['orgMembers', state?.team.id],
    queryFn: () => cloudTeamApi.getOrgMembers(state!.team.id),
    enabled: isAuthor,
    staleTime: 60_000,
  });

  async function attempt(action: () => Promise<void>) {
    setActionError(null);
    try {
      await action();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Sharing failed');
    }
  }

  if (!state) {
    return sharing.error ? (
      <p className="text-tiny tracking-tiny text-status-err">
        {sharing.error instanceof Error ? sharing.error.message : 'Failed to load sharing'}
      </p>
    ) : (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-4 w-4 animate-spin text-text-passive" />
      </div>
    );
  }

  const rows = sharePeopleRows(state);
  const withAccess = rows.flatMap((row) =>
    (row.kind === 'member' && row.member.user_id) || row.kind === 'via_work_item' ? [row.key] : []
  );

  return (
    <div className="flex flex-col gap-4">
      {isAuthor && roster.data && (
        <ShareInvitePicker
          teamName={state.team.name}
          roster={roster.data}
          authorId={state.author.user_id}
          memberUserIds={withAccess}
          onInvite={sharing.addMember}
        />
      )}
      {roster.error instanceof Error && (
        <p className="text-tiny tracking-tiny text-status-err">
          Couldn&apos;t load {state.team.name}: {roster.error.message}
        </p>
      )}
      {actionError && <p className="text-tiny tracking-tiny text-status-err">{actionError}</p>}

      <SharePeopleList
        rows={rows}
        canManage={isAuthor}
        onRoleChange={(memberId, role) => attempt(() => sharing.updateMemberRole(memberId, role))}
        onRemove={(memberId) => attempt(() => sharing.removeMember(memberId))}
        onOpenArtifact={onOpenArtifact}
      />

      <ShareGeneralAccess
        state={state}
        canManage={isAuthor}
        onChange={(access, role) => attempt(() => sharing.setGeneralAccess(access, role))}
      />

      {isAuthor && scope.kind === 'work_item' && (
        <AgentDrivingToggle workItemId={workItemId} onError={reportError} />
      )}
    </div>
  );
}
