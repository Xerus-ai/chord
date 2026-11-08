import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { JustMePatch, TeamConfigPatch } from '@shared/repo-config';
import type { Result } from '@shared/result';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';

/**
 * One repository's settings page: its settings (each with the layer it came
 * from), what it would run vs. what is trusted, and its lanes — plus the
 * writes. Every write refetches all three, since a team edit or a revoke can
 * change what the other two show.
 */

export const repoSettingsQueryKey = (repoId: string) => ['repoSettings', repoId] as const;

/** For calls whose only failures are bugs: the error is thrown into the query. */
async function unwrap<T, E>(call: Promise<Result<T, E>>): Promise<T> {
  const result = await call;
  if (!result.success) throw new Error(JSON.stringify(result.error));
  return result.data;
}

export function useRepoSettings(repoId: string) {
  const queryClient = useQueryClient();
  const key = repoSettingsQueryKey(repoId);

  const settings = useQuery({
    queryKey: [...key, 'settings'],
    queryFn: () => unwrap(rpc.repoSettings.get(repoId)),
  });
  const trust = useQuery({
    queryKey: [...key, 'trust'],
    queryFn: () => unwrap(rpc.repoSettings.getTrust(repoId)),
  });
  const lanes = useQuery({
    queryKey: [...key, 'lanes'],
    queryFn: async () => (await unwrap(rpc.repoSettings.listLanes(repoId))).lanes,
  });

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: repoSettingsQueryKey(repoId) }),
    [queryClient, repoId]
  );

  /** Resolves null once saved, else why it was not: for a field that shows it in place. */
  const saveJustMeReporting = useCallback(
    async (patch: JustMePatch): Promise<string | null> => {
      const result = await rpc.repoSettings.updateJustMe({ repoId, patch });
      await refresh();
      return result.success ? null : result.error.message;
    },
    [repoId, refresh]
  );

  /** Resolves true once saved; a value the user can fix is shown as a toast. */
  const saveJustMe = useCallback(
    async (patch: JustMePatch): Promise<boolean> => {
      const refused = await saveJustMeReporting(patch);
      if (refused !== null) {
        toast({ title: 'Not saved', description: refused, variant: 'destructive' });
        return false;
      }
      return true;
    },
    [saveJustMeReporting]
  );

  const saveTeam = useCallback(
    async (patch: TeamConfigPatch): Promise<boolean> => {
      const result = await rpc.repoSettings.writeTeamFile({ repoId, patch });
      await refresh();
      if (!result.success) {
        toast({
          title: '.chord.json not changed',
          description: result.error.message,
          variant: 'destructive',
        });
        return false;
      }
      const base = settings.data?.baseRef ?? 'the base branch';
      toast({
        title: 'Wrote .chord.json — not committed',
        description: `${result.data.path}. New lanes read it from ${base}, so the change applies once you commit it and it reaches ${base}.`,
      });
      return true;
    },
    [repoId, refresh, settings.data?.baseRef]
  );

  const revokeTrust = useCallback(async () => {
    const { lanes: laneCount } = await unwrap(rpc.repoSettings.revokeTrust(repoId));
    await refresh();
    toast({
      title: 'Trust revoked',
      description: `Always trust is off and ${laneCount === 1 ? '1 lane approval was' : `${laneCount} lane approvals were`} removed. The next script of any lane asks first.`,
    });
  }, [repoId, refresh]);

  const turnOffAlwaysTrust = useCallback(async () => {
    await unwrap(rpc.repoSettings.turnOffAlwaysTrust(repoId));
    await refresh();
  }, [repoId, refresh]);

  return {
    settings,
    trust,
    lanes,
    refresh,
    saveJustMe,
    saveJustMeReporting,
    saveTeam,
    revokeTrust,
    turnOffAlwaysTrust,
  };
}

export type RepoSettingsData = NonNullable<ReturnType<typeof useRepoSettings>['settings']['data']>;
