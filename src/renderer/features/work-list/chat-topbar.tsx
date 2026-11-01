import { useRailStore } from '@renderer/features/right-rail/rail-store';
import type { SharingAvailability } from '@renderer/features/sharing/sharing-availability';
import { OpenInMenu } from '@renderer/lib/components/titlebar/open-in-menu';
import { useAccountSession } from '@renderer/lib/hooks/useAccount';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { ClosedRailStateChip } from './closed-rail-chip';
import { HeaderLanePrChips } from './header-lane-pr-chips';
import { useParticipants } from './use-participants';
import { useWorkItemViewers } from './use-viewing-presence';
import { WorkItemHeader } from './work-item-header';
import { headerModel } from './work-item-header-model';
import { useWorkItemSource } from './work-item-source';

/**
 * The owner's header: `WorkItemHeader` over this machine's item. The avatar
 * stack is the people it is shared with; Share works once the item can be
 * shared (sharing-availability.ts); Open in editor, every lane's PR chip and
 * the closed rail's state chip read the local checkout.
 */
export function ChatTopbar({
  title,
  repoBadge,
  repoPath,
  workItemId,
  sharing,
  activeArtifactId,
  onRename,
}: {
  title: string;
  repoBadge: string;
  repoPath: string;
  workItemId: string;
  /** Whether Share works yet, and if not, why (sharing-availability.ts). */
  sharing: SharingAvailability;
  /** The artifact tab in focus: Share preselects it. */
  activeArtifactId: string | null;
  onRename: (newName: string) => void;
}) {
  const { capabilities } = useWorkItemSource();
  // An item that cannot be shared yet has no roster to read (it would 404).
  const { participants } = useParticipants(sharing.kind === 'available' ? workItemId : undefined);
  const viewers = useWorkItemViewers(workItemId);
  const { data: session } = useAccountSession();
  const toggleRail = useRailStore((state) => state.toggleOpen);
  const showShare = useShowModal('shareModal');

  const model = headerModel({
    capabilities,
    title,
    repoBadge,
    shareUnavailableReason: sharing.kind === 'available' ? null : sharing.reason,
    ownerLabel: null,
    status: null,
    branch: null,
    prNumber: null,
    participants,
    viewers,
    selfId: session?.user?.userId ?? null,
  });

  return (
    <WorkItemHeader
      model={model}
      viewers={viewers}
      onRename={onRename}
      onShare={() =>
        showShare({ workItemId, workItemName: title, artifactId: activeArtifactId ?? undefined })
      }
      railClosedChip={<ClosedRailStateChip workItemId={workItemId} onOpenRail={toggleRail} />}
      lanePrChips={<HeaderLanePrChips workItemId={workItemId} />}
      openIn={<OpenInMenu path={repoPath} iconOnly />}
    />
  );
}
