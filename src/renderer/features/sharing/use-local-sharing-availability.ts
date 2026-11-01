import { useCallback, useMemo } from 'react';
import { isOwnedByAnotherAccount } from '@shared/work-item-ownership';
import type { WorkItemRow } from '@main/db/schema-work-items';
import { useAccountSession, useAuthState } from '@renderer/lib/hooks/useAccount';
import type { SharingPerson } from './sharing-api';
import {
  sharingAvailability,
  toLocalAuthor,
  type SharingAvailability,
} from './sharing-availability';

type LocalSharingFacts = Pick<WorkItemRow, 'ownerAccountId' | 'cloudId'>;

/** The signed-in account as a People row's person; null while no one is signed in. */
export function useLocalAuthor(): SharingPerson | null {
  const { data: session } = useAccountSession();
  const user = session?.user ?? null;
  return useMemo(() => (user ? toLocalAuthor(user) : null), [user]);
}

/**
 * The session facts every Share entry for a local work item needs; `of`
 * answers for one row (a sidebar's worth of rows share one session).
 */
export function useLocalSharingAvailabilityOf(): (item: LocalSharingFacts) => SharingAvailability {
  const authState = useAuthState();
  const localAuthor = useLocalAuthor();
  const userId = localAuthor?.user_id ?? null;
  return useCallback(
    (item: LocalSharingFacts) =>
      sharingAvailability({
        authState,
        ownedByAnotherAccount: isOwnedByAnotherAccount(item.ownerAccountId, userId),
        // The cloud id is stamped when the create lands, or when the startup
        // reconcile finds the item already there (sync-queue-service.ts).
        synced: item.cloudId !== null,
        // A work item on this machine is its owner's.
        isOwner: true,
        localAuthor,
      }),
    [authState, userId, localAuthor]
  );
}

/** Whether this machine's own work item can be shared now, and if not, why. */
export function useLocalSharingAvailability(item: LocalSharingFacts): SharingAvailability {
  return useLocalSharingAvailabilityOf()(item);
}
