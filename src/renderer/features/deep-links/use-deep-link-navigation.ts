import { useEffect } from 'react';
import { deepLinkOpenChannel, type DeepLinkTarget } from '@shared/events/deepLinkEvents';
import { toast } from '@renderer/lib/hooks/use-toast';
import { events, rpc } from '@renderer/lib/ipc';
import { log } from '@renderer/utils/logger';
import { orderDeepLinkNavigations } from './claimed-deep-links';
import { navigationForDeepLink } from './deep-link-navigation';
import { useOpenTarget } from './use-open-target';

/**
 * Opens `chord://open/…` links. Main holds links that arrive before the
 * renderer is ready; the renderer subscribes to live links FIRST, then claims
 * the held ones once. A live link that lands while the claim is in flight is
 * newer than every held one, so it is buffered and opened after them.
 *
 * Claimed links are opened even if this effect was torn down meanwhile: main
 * hands each held link out exactly once, so dropping a claimed result would
 * lose the link for good.
 */
export function useDeepLinkNavigation(): void {
  const openTarget = useOpenTarget();

  useEffect(() => {
    let claimSettled = false;
    const liveDuringClaim: DeepLinkTarget[] = [];

    const off = events.on(deepLinkOpenChannel, (target) => {
      if (!claimSettled) {
        liveDuringClaim.push(target);
        return;
      }
      openTarget(navigationForDeepLink(target));
    });

    const openInOrder = (claimed: DeepLinkTarget[]) => {
      claimSettled = true;
      for (const navigation of orderDeepLinkNavigations({ claimed, liveDuringClaim })) {
        openTarget(navigation);
      }
    };

    rpc.deepLinks.claimPending().then(
      (result) => openInOrder(result.data.targets),
      (error: unknown) => {
        const description = error instanceof Error ? error.message : String(error);
        log.error('deep links: claiming the links held by main failed', { error });
        toast({
          title: 'A link could not be opened',
          description: `Links opened before Chord was ready were lost: ${description}`,
          variant: 'destructive',
        });
        // Links that arrived live are still opened.
        openInOrder([]);
      }
    );

    return off;
  }, [openTarget]);
}
