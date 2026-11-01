import type {
  AvatarStackMember,
  AvatarStackViewer,
} from '@renderer/lib/components/chrome/avatar-stack';
import { stackMembers } from './header-stack';
import type { WorkItemCapabilities } from './work-item-access';

/**
 * Sharing is reserved for the work item's creator (requireWorkItemCreator on
 * the server). A teammate still sees Share, greyed with this reason: a control
 * that explains itself teaches the feature exists; a missing one reads as a
 * broken build.
 */
export const SHARE_OWNER_ONLY_REASON =
  'Only the owner can manage who this work item is shared with.';

export interface HeaderModelInput {
  capabilities: Pick<WorkItemCapabilities, 'share' | 'editItem' | 'files'>;
  title: string;
  repoBadge: string;
  /** Why sharing does not work yet for an owner's item (sign-in, sync); null when it does. */
  shareUnavailableReason: string | null;
  /** Who shared it, for a teammate; null for the owner. */
  ownerLabel: string | null;
  /** The facts the owner's rail shows them, which a teammate reads in the header. */
  status: string | null;
  branch: string | null;
  prNumber: number | null;
  participants: AvatarStackMember[];
  viewers: AvatarStackViewer[];
  selfId: string | null;
}

export type HeaderShare =
  | { kind: 'open' }
  | { kind: 'blocked'; reason: string }
  | { kind: 'hidden' };

export interface HeaderModel {
  title: string;
  repoBadge: string;
  canRename: boolean;
  share: HeaderShare;
  sharedBy: string | null;
  status: string | null;
  branch: string | null;
  prNumber: number | null;
  stack: { members: AvatarStackMember[]; ringedIds: Set<string> };
  /** Open in editor needs the checkout. */
  openInEditor: boolean;
}

/** What the work item's header shows, for any viewer (step 4, S6). */
export function headerModel(input: HeaderModelInput): HeaderModel {
  const { capabilities } = input;
  const share: HeaderShare =
    capabilities.share === 'hidden'
      ? { kind: 'hidden' }
      : capabilities.share === 'blocked'
        ? { kind: 'blocked', reason: SHARE_OWNER_ONLY_REASON }
        : input.shareUnavailableReason
          ? { kind: 'blocked', reason: input.shareUnavailableReason }
          : { kind: 'open' };
  return {
    title: input.title,
    repoBadge: input.repoBadge,
    canRename: capabilities.editItem,
    share,
    sharedBy: input.ownerLabel,
    status: input.status,
    branch: input.branch,
    prNumber: input.prNumber,
    stack: stackMembers(input.participants, input.viewers, input.selfId),
    openInEditor: capabilities.files,
  };
}
