import { useCallback, useState } from 'react';
import { useInvalidateRepos } from '@renderer/lib/hooks/use-repos';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';

/**
 * "Detect from repository", with the one thing the menu cannot do itself: say
 * what happened.
 *
 * All three outcomes are surfaced, because `none` and `failed` mean opposite
 * things to the user. `none` is an answer — there is no icon to find, stop
 * looking. `failed` is "ask again later", and reporting it as `none` would
 * leave someone on a flaky connection believing their repo has no icon. A
 * silent no-op would hide both.
 */
export function useDetectRepoIcon(): {
  detectRepoIcon: (repoId: string) => void;
  /** The repo whose detection is in flight — drives the menu's spinner. */
  detectingRepoId: string | null;
} {
  const [detectingRepoId, setDetectingRepoId] = useState<string | null>(null);
  const invalidateRepos = useInvalidateRepos();

  const detectRepoIcon = useCallback(
    (repoId: string) => {
      setDetectingRepoId(repoId);
      void rpc.repos
        .detectIcon({ id: repoId })
        .then((result) => {
          if (!result.success) {
            toast({ title: 'Could not detect an icon', variant: 'destructive' });
            return;
          }
          const { outcome } = result.data;
          if (outcome.kind === 'none') {
            toast({
              title: 'No icon found',
              description: 'This repository has no icon file and its owner has no avatar.',
            });
          } else if (outcome.kind === 'failed') {
            toast({
              title: 'Could not reach GitHub',
              description: 'Detection will run again the next time the app starts.',
              variant: 'destructive',
            });
          }
          invalidateRepos();
        })
        .finally(() => setDetectingRepoId(null));
    },
    [invalidateRepos]
  );

  return { detectRepoIcon, detectingRepoId };
}
