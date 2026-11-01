import type { Participant } from '@renderer/features/sharing/sharing-api';
import type { WorkItemViewer } from '@renderer/features/work-list/use-viewing-presence';
import { WorkItemHeader } from '@renderer/features/work-list/work-item-header';
import { headerModel } from '@renderer/features/work-list/work-item-header-model';
import { useWorkItemSource } from '@renderer/features/work-list/work-item-source';
import type { CloudWorkItem } from '@renderer/lib/cloud-api';
import { useAccountSession } from '@renderer/lib/hooks/useAccount';
import { useShowModal } from '@renderer/lib/modal/modal-provider';

const NO_PARTICIPANTS: Participant[] = [];

/**
 * A teammate's header: `WorkItemHeader` over the cloud item. It names who
 * shared the item, and shows the status, branch and PR the owner reads in
 * their rail. Share is the author's only (`capabilities.share`), greyed with
 * the reason for everyone else.
 */
export function CloudWorkItemHeader({
  item,
  participants = NO_PARTICIPANTS,
  viewers,
  activeArtifactId,
}: {
  item: CloudWorkItem;
  participants?: Participant[];
  viewers: WorkItemViewer[];
  /** The artifact tab in focus: Share preselects it. */
  activeArtifactId: string | null;
}) {
  const { capabilities } = useWorkItemSource();
  const { data: session } = useAccountSession();
  const selfId = session?.user?.userId ?? null;
  const showShare = useShowModal('shareModal');
  const owner = participants.find((p) => p.role === 'author');
  // The author reading their own item on another machine shared it with nobody.
  const ownerLabel = owner && owner.user_id !== selfId ? (owner.name ?? owner.email) : null;

  const model = headerModel({
    capabilities,
    title: item.name,
    repoBadge: item.repo_name ?? '',
    shareUnavailableReason: null,
    ownerLabel,
    status: item.status,
    branch: item.branch_name,
    prNumber: item.pr_number,
    participants,
    viewers,
    selfId,
  });

  return (
    <WorkItemHeader
      model={model}
      viewers={viewers}
      onShare={() =>
        showShare({
          workItemId: item.id,
          workItemName: item.name,
          artifactId: activeArtifactId ?? undefined,
        })
      }
    />
  );
}
