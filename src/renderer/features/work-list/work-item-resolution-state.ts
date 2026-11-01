import type { ArtifactsOnlyWorkItem } from '@chord/protocol';
import type { WorkItemRow } from '@main/db/schema-work-items';
import type { CloudWorkItem } from '@renderer/lib/cloud-api';

export type WorkItemResolution =
  | { kind: 'local'; item: WorkItemRow }
  | { kind: 'cloud'; item: CloudWorkItem }
  /** Reached only through artifacts shared alone: a header, never its chat or git state. */
  | { kind: 'artifacts_only'; item: ArtifactsOnlyWorkItem }
  | { kind: 'loading' }
  | { kind: 'not_found' }
  | { kind: 'no_access' }
  | { kind: 'deleted' }
  | { kind: 'signed_out' }
  | { kind: 'error'; retry: () => void };

/** What the per-id `GET /work-items/:id` has produced so far. */
export type CloudFetchState =
  | { kind: 'pending' }
  | { kind: 'failed'; status: number | null }
  | { kind: 'loaded'; item: CloudWorkItem | ArtifactsOnlyWorkItem };

export interface WorkItemResolutionInput {
  workItemId: string | null;
  localItem: WorkItemRow | undefined;
  /** The local list has been read *for this id*, so a miss is a real miss. */
  localListSettled: boolean;
  isDeleted: boolean;
  sessionPending: boolean;
  isSignedIn: boolean;
  cloud: CloudFetchState;
  retry: () => void;
}

/**
 * The resolution decision table. Order is the whole contract, so it lives here
 * as a pure function rather than inline in the hook that feeds it.
 */
export function decideWorkItemResolution(input: WorkItemResolutionInput): WorkItemResolution {
  const {
    workItemId,
    localItem,
    localListSettled,
    isDeleted,
    sessionPending,
    isSignedIn,
    cloud,
    retry,
  } = input;

  if (workItemId === null) return { kind: 'loading' };

  // A local hit outranks every cloud outcome, including an already-cached 4xx:
  // an item this machine owns is never resolved over the network.
  if (localItem !== undefined) return { kind: 'local', item: localItem };

  if (isDeleted) return { kind: 'deleted' };

  // Until the local list has been read for this id, a miss proves nothing —
  // reporting a terminal cloud state here is how a just-created local item
  // ended up as "This work item doesn't exist".
  if (!localListSettled) return { kind: 'loading' };

  if (sessionPending) return { kind: 'loading' };
  if (!isSignedIn) return { kind: 'signed_out' };

  if (cloud.kind === 'failed') {
    if (cloud.status === 404) return { kind: 'not_found' };
    if (cloud.status === 403) return { kind: 'no_access' };
    if (cloud.status === 401) return { kind: 'signed_out' };
    return { kind: 'error', retry };
  }

  if (cloud.kind === 'pending') return { kind: 'loading' };
  if (cloud.item.access_scope === 'artifacts') return { kind: 'artifacts_only', item: cloud.item };
  return { kind: 'cloud', item: cloud.item };
}
