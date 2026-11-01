import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cloudTeamApi } from '@renderer/lib/cloud-team-api';
import { describeLoadError } from '@renderer/lib/components/load-error-notice';
import { useAccountSession } from '@renderer/lib/hooks/useAccount';
import { Input } from '@renderer/lib/ui/input';
import { canSaveWorkspaceName } from '@renderer/lib/workspace-name';
import {
  FooterAction,
  OnboardingSection,
  RowSkeleton,
  RowStatus,
  RowTile,
  SectionFooter,
  SectionRow,
} from './onboarding-section';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const ESTIMATE = { kind: 'estimate', label: '30 sec' } as const;
const DESCRIPTION = 'This is what your team sees when they join.';

/**
 * The "name your workspace" step. Every account gets an org bootstrapped
 * server-side on first sign-in (auto-named "<name>'s workspace"); this is
 * where an owner replaces that generated name with the team's real one. An
 * invited member can't rename, so they see which team they just joined.
 *
 * There is no Save button: the name commits on Enter or when the field loses
 * focus, because onboarding has no step to "continue" to.
 */
export function OnboardingWorkspaceSection({
  index,
  isNext,
  onDone,
}: {
  index: number;
  isNext: boolean;
  onDone: () => void;
}) {
  const { data: session } = useAccountSession();
  const queryClient = useQueryClient();
  const orgId = (session?.user as { orgId?: string | null } | undefined)?.orgId ?? null;

  const {
    data: memberships,
    isPending,
    isError,
    error: loadError,
    refetch,
  } = useQuery({
    queryKey: ['organizations', 'memberships'],
    queryFn: () => cloudTeamApi.getOrgs(),
    enabled: !!orgId,
    staleTime: 30_000,
  });

  const membership = memberships?.find((m) => m.org_id === orgId) ?? null;
  const canRename = membership?.role === 'owner' || membership?.role === 'admin';

  // Deliberately NOT seeded from `membership.name`: pre-filling hid the
  // placeholder and made the field look already answered. The current name is
  // offered by "Keep it" in the footer instead.
  const [name, setName] = useState('');
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [kept, setKept] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentName = membership?.name ?? '';
  const canSave = canSaveWorkspaceName(name, currentName);

  // A member, an account with no org, or a workspace that failed to load has
  // nothing to decide here — the step self-completes so the counter doesn't
  // dangle on something the user can't act on.
  //
  // `isPending`, not `isLoading`: v5's isLoading is `isPending && isFetching`,
  // which is false on the first render before the fetch starts — the step then
  // saw no membership and marked itself done before any data had arrived.
  const selfCompletes = !orgId || (!isPending && (isError || !membership || !canRename));
  useEffect(() => {
    if (selfCompletes) onDone();
  }, [selfCompletes, onDone]);

  const handleSave = async () => {
    if (!orgId || !canSave || status === 'saving' || status === 'saved') return;
    setStatus('saving');
    setError(null);
    try {
      await cloudTeamApi.renameOrg(orgId, name.trim());
      // Same list the sidebar and Team settings read — refetch it rather than
      // leave `currentName` stale (a stale name kept `canSave` true, so the
      // blur after Enter sent the rename a second time).
      await queryClient.invalidateQueries({ queryKey: ['organizations', 'memberships'] });
      setStatus('saved');
      onDone();
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : 'Failed to rename workspace');
    }
  };

  const handleKeep = () => {
    setKept(true);
    onDone();
  };

  const section = { index, isNext, meta: ESTIMATE, description: DESCRIPTION };

  if (!orgId) {
    return (
      <OnboardingSection {...section} title="Name your workspace" state="done">
        <SectionRow
          label="Working locally"
          detail="Your team workspace appears here once you're online."
        />
      </OnboardingSection>
    );
  }

  if (isPending) {
    return (
      <OnboardingSection {...section} title="Name your workspace" state="pending">
        <RowSkeleton />
      </OnboardingSection>
    );
  }

  // The rename form is only offered when the workspace it would rename is
  // actually loaded — against a failed fetch it could only answer "Failed".
  if (isError || !membership) {
    return (
      <OnboardingSection
        {...section}
        title="Name your workspace"
        state={isError ? 'error' : 'done'}
        footer={
          <SectionFooter tone={isError ? 'error' : 'hint'}>
            {isError
              ? describeLoadError(loadError)
              : "This workspace hasn't finished setting up. You can rename it any time from Settings › Team."}
            <FooterAction onClick={() => void refetch()}>Retry</FooterAction>
          </SectionFooter>
        }
      >
        <SectionRow label="Workspace name" detail="Couldn't load your workspace." />
      </OnboardingSection>
    );
  }

  if (!canRename) {
    return (
      <OnboardingSection
        {...section}
        title="You've joined a workspace"
        state="done"
        answer={<span className="font-medium text-text-muted">{membership.name}</span>}
        footer={<SectionFooter>Only owners and admins can rename a workspace.</SectionFooter>}
      >
        <SectionRow
          leading={
            <RowTile className="text-tiny font-semibold">{membership.name.charAt(0)}</RowTile>
          }
          label={membership.name}
          control={<RowStatus>Joined</RowStatus>}
        />
      </OnboardingSection>
    );
  }

  const saved = status === 'saved';
  const answerName = saved ? name.trim() : kept ? currentName : null;

  return (
    <OnboardingSection
      {...section}
      title="Name your workspace"
      state={error ? 'error' : answerName ? 'done' : 'todo'}
      answer={answerName && <span className="font-medium text-text-muted">{answerName}</span>}
      footer={
        error ? (
          <SectionFooter tone="error">{error}</SectionFooter>
        ) : !answerName && currentName !== '' ? (
          <SectionFooter>
            <span>
              Currently <span className="font-medium text-text-muted">{currentName}</span>,
              generated at sign-in.
            </span>
            <FooterAction onClick={handleKeep}>Keep it</FooterAction>
          </SectionFooter>
        ) : undefined
      }
    >
      <SectionRow
        label="Workspace name"
        detail={status === 'saving' ? 'Saving…' : saved ? 'Saved' : 'Saved when you press Enter.'}
        control={
          <div className="relative w-75">
            <Input
              placeholder="Acme Engineering"
              aria-label="Workspace name"
              value={name}
              disabled={status === 'saving'}
              onChange={(e) => {
                setName(e.target.value);
                if (status !== 'idle') setStatus('idle');
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleSave();
                }
              }}
              onBlur={() => void handleSave()}
              className="bg-surface-inset pr-8"
            />
            {status === 'saving' && (
              <Loader2 className="absolute top-1/2 right-2.5 size-icon-sm -translate-y-1/2 animate-spin text-text-passive" />
            )}
          </div>
        }
      />
    </OnboardingSection>
  );
}
