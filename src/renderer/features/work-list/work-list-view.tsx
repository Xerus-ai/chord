import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { CloudWorkItemView } from '@renderer/features/cloud-source/cloud-work-item-view';
import { ScopedWorkItemView } from '@renderer/features/cloud-source/scoped-work-item-view';
import { StateCard } from '@renderer/lib/components/state-card';
import { useInvalidateWorkItems, useWorkItems } from '@renderer/lib/hooks/use-work-items';
import { useAccountSignIn } from '@renderer/lib/hooks/useAccount';
import { useParams } from '@renderer/lib/layout/navigation-provider';
import { LocalWorkItemView } from './local-work-item-view';
import type { RequestedArtifact } from './requested-artifact-layout';
import type { RequestedMessage } from './requested-message';
import { useOpenRequestedArtifact } from './use-open-requested-artifact';
import { useRequestedSelection } from './use-requested-selection';
import { useRevealRequestedMessage } from './use-reveal-requested-message';
import { useWorkItemResolution } from './use-work-item-resolution';

const ACTION_BUTTON_CLASS =
  'cursor-pointer rounded-lg bg-action-bg px-4 py-1.5 text-tiny tracking-tiny font-bold text-action-fg transition-colors duration-100 hover:bg-action-bg-hover';

function WorkListMainPanel() {
  const { params, setParams } = useParams('work-list');
  const incomingId = params.workItemId ?? null;
  const { items, isFetched, refetchWorkItems } = useWorkItems();
  const invalidateWorkItems = useInvalidateWorkItems();
  const selectedId = useRequestedSelection(incomingId);
  const signIn = useAccountSignIn();

  // An explicit navigation is an intent to re-resolve: without this, a cached
  // 403 keeps the no-access card up after the owner re-shares — even though
  // the card itself says "open it again from the sidebar". Terminal states
  // stay terminal while on screen; only a user-driven request re-checks.
  const queryClient = useQueryClient();
  useEffect(() => {
    if (incomingId) void queryClient.invalidateQueries({ queryKey: ['workItem', incomingId] });
  }, [incomingId, queryClient]);

  // `chord:create-work-item` is handled by AppSidebar, not here. This panel
  // only exists on the work-list view, so a listener at this level could not
  // serve Mod+N or the palette from anywhere else — and a second listener here
  // would open the modal twice whenever both were mounted.

  // The first-item default applies only when no id was requested. Reloading the
  // list never touches the selection — resetting it there is what used to
  // clobber a requested cloud id with the first local item.
  const effectiveId = selectedId ?? (incomingId === null && items.length > 0 ? items[0].id : null);
  const localItem = effectiveId !== null ? items.find((i) => i.id === effectiveId) : undefined;

  // A missed local hit is ambiguous: the requested id may just be newer than
  // the list. Creating a work item hands its id straight to navigation, so it
  // arrives before any refetch has run. Re-read the local list once per
  // requested id and only let the cloud resolve the id after that read settles
  // — otherwise a brand-new local item is looked up over the network, where it
  // 404s until its sync-queue entry drains (or, if the fetch loses that race
  // instead, resolves as a cloud item the owner can't drive).
  const [localCheckedId, setLocalCheckedId] = useState<string | null>(null);
  useEffect(() => {
    if (effectiveId === null || localItem !== undefined || localCheckedId === effectiveId) return;
    let active = true;
    void refetchWorkItems().finally(() => {
      if (active) setLocalCheckedId(effectiveId);
    });
    return () => {
      active = false;
    };
  }, [effectiveId, localItem, localCheckedId, refetchWorkItems]);

  const resolution = useWorkItemResolution(effectiveId, localItem, localCheckedId === effectiveId);

  const clearRequestedId = useCallback(() => {
    setParams({ workItemId: undefined });
  }, [setParams]);

  const consumeRequestedArtifact = useCallback(() => {
    setParams({ openArtifact: undefined });
  }, [setParams]);
  useOpenRequestedArtifact(resolution, params.openArtifact, consumeRequestedArtifact);

  const consumeRequestedMessage = useCallback(() => {
    setParams({ revealMessage: undefined });
  }, [setParams]);
  useRevealRequestedMessage(resolution, params.revealMessage, consumeRequestedMessage);

  // A live-deleted item clears its params like a revocation: the terminal
  // card stays on screen, but the dead id must never be re-imposed by the
  // params-sync.
  const isDeleted = resolution.kind === 'deleted';
  useEffect(() => {
    if (isDeleted) clearRequestedId();
  }, [isDeleted, clearRequestedId]);

  if (!isFetched || effectiveId === null) {
    // Booting, or nothing requested and nothing local: the empty workspace.
    return <div className="flex h-full overflow-hidden bg-surface" />;
  }

  switch (resolution.kind) {
    case 'local':
      return (
        <div className="flex h-full overflow-hidden bg-surface">
          {/* Keyed like the cloud branch below: the panel owns centerTab and
              sessions, so an unkeyed switch between two work items reuses the
              instance and renders item A's diff/terminal tab inside item B. */}
          <LocalWorkItemView
            key={resolution.item.id}
            item={resolution.item}
            onItemChanged={invalidateWorkItems}
          />
        </div>
      );
    case 'cloud':
      return (
        <div className="flex h-full overflow-hidden bg-surface">
          <CloudWorkItemView
            key={resolution.item.id}
            item={resolution.item}
            onRevoked={clearRequestedId}
          />
        </div>
      );
    case 'artifacts_only':
      return (
        <div className="flex h-full overflow-hidden bg-surface">
          <ScopedWorkItemView
            key={resolution.item.id}
            item={resolution.item}
            awaitingArtifact={params.openArtifact !== undefined}
          />
        </div>
      );
    case 'loading':
      return <div className="flex h-full overflow-hidden bg-surface" />;
    case 'not_found':
      return (
        <StateCard
          badge="Not found"
          tone="error"
          title="This work item doesn't exist"
          description="It may have been deleted, or the link you followed is stale."
        />
      );
    case 'deleted':
      return (
        <StateCard
          badge="Deleted"
          tone="error"
          title="This work item was deleted"
          description="The owner deleted it while you were viewing. It's gone from your shared list too."
        />
      );
    case 'no_access':
      return (
        <StateCard
          badge="No access"
          tone="error"
          title="You don't have access to this work item"
          description="Ask the owner to share it with you, then open it again from the sidebar."
        />
      );
    case 'signed_out':
      return (
        <StateCard
          badge="Signed out"
          title="Sign in to view this shared work item"
          description="Shared work items live in the cloud and need a signed-in session to resolve."
          action={
            <button onClick={() => signIn.mutate()} className={ACTION_BUTTON_CLASS}>
              Sign in
            </button>
          }
        />
      );
    case 'error':
      return (
        <StateCard
          badge="Error"
          tone="error"
          title="Couldn't load this work item"
          description="The cloud request failed. Check your connection and retry."
          action={
            <button onClick={resolution.retry} className={ACTION_BUTTON_CLASS}>
              Retry
            </button>
          }
        />
      );
    default: {
      resolution satisfies never;
      return null;
    }
  }
}

function WorkListWrapper({
  children,
}: {
  children: React.ReactNode;
  workItemId?: string;
  /** An artifact to open as a tab once the work item resolves. */
  openArtifact?: RequestedArtifact;
  /** A chat message to open its chat on and scroll to, once the work item resolves. */
  revealMessage?: RequestedMessage;
}) {
  return <>{children}</>;
}

export const workListView = {
  WrapView: WorkListWrapper,
  TitlebarSlot: () => null,
  MainPanel: WorkListMainPanel,
};
