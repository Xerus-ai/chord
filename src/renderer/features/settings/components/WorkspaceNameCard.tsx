import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { cloudTeamApi } from '@renderer/lib/cloud-team-api';
import { describeLoadError, LoadErrorNotice } from '@renderer/lib/components/load-error-notice';
import { FOCUS_RING } from '@renderer/lib/ui/focus-ring';
import { canSaveWorkspaceName } from '@renderer/lib/workspace-name';
import { cn } from '@renderer/utils/utils';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Renames the workspace after onboarding. Until this existed, `renameOrg` had
 * exactly one caller — the onboarding step — so anyone who chose "Keep <name>"
 * or skipped onboarding could never change the name WorkOS had generated for
 * them (commonly their email domain).
 *
 * Name is the only field: `organizations.slug` is never read by anything and
 * has no update route, and there is no workspace image anywhere in the schema.
 */
export function WorkspaceNameCard({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();

  const {
    data: memberships,
    isLoading,
    isError,
    error: loadError,
    refetch,
  } = useQuery({
    queryKey: ['organizations', 'memberships'],
    queryFn: () => cloudTeamApi.getOrgs(),
    staleTime: 30_000,
  });

  const membership = memberships?.find((m) => m.org_id === orgId) ?? null;
  const currentName = membership?.name ?? '';
  const isAdmin = membership?.role === 'owner' || membership?.role === 'admin';

  const [name, setName] = useState('');
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const canSave = canSaveWorkspaceName(name, currentName);

  const handleSave = async () => {
    if (!canSave) return;
    const trimmed = name.trim();

    setStatus('saving');
    setError(null);
    try {
      await cloudTeamApi.renameOrg(orgId, trimmed);
      // The list this card reads from is the same one the sidebar and team tab
      // read — refetch it rather than patching a local copy.
      await queryClient.invalidateQueries({ queryKey: ['organizations', 'memberships'] });
      setName('');
      setStatus('saved');
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : 'Failed to rename workspace');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-surface-raised p-4">
        <Loader2 className="h-4 w-4 animate-spin text-text-passive" />
        <span className="text-body tracking-body text-text-passive">Loading workspace...</span>
      </div>
    );
  }

  if (isError || !membership) {
    return (
      <LoadErrorNotice
        title="Couldn't load your workspace"
        message={
          isError
            ? describeLoadError(loadError)
            : "You're signed in, but this workspace hasn't finished setting up yet."
        }
        onRetry={() => void refetch()}
      />
    );
  }

  return (
    <div className="rounded-lg border border-border/60 bg-surface-raised p-4">
      <h3 className="text-body tracking-body font-medium text-text">Workspace</h3>
      <p className="mt-0.5 text-tiny tracking-tiny text-text-passive">
        This is what your team sees when they join.
      </p>

      <div className="mt-3 flex items-center gap-2">
        <span className="text-tiny tracking-tiny text-text-passive">Currently</span>
        <span className="truncate text-body tracking-body font-medium text-text">
          {currentName}
        </span>
      </div>

      {isAdmin ? (
        <>
          <div className="mt-3 flex gap-2">
            <input
              type="text"
              placeholder="Acme Engineering"
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
              className={cn(
                'flex-1 rounded-md border border-border-strong bg-surface px-3 py-2 text-body tracking-body text-text placeholder:text-text-passive transition-colors disabled:bg-action-bg-disabled disabled:text-action-fg-disabled',
                FOCUS_RING
              )}
            />
            <button
              onClick={() => void handleSave()}
              disabled={status === 'saving' || !canSave}
              className={cn(
                'flex items-center gap-1.5 rounded-md border border-border-strong bg-transparent px-3 py-1 text-tiny tracking-tiny font-medium text-text-muted transition-colors hover:border-border-strong hover:bg-surface-inset hover:text-text disabled:cursor-default disabled:text-text-disabled',
                FOCUS_RING
              )}
            >
              {status === 'saving' && <Loader2 className="h-3 w-3 animate-spin" />}
              {status === 'saved' && <Check className="h-3 w-3" />}
              {status === 'saved' ? 'Saved' : 'Rename'}
            </button>
          </div>
          {error && <p className="mt-2 text-tiny tracking-tiny text-status-err">{error}</p>}
        </>
      ) : (
        <p className="mt-3 text-tiny tracking-tiny text-text-passive">
          Only workspace admins can change the name.
        </p>
      )}
    </div>
  );
}
