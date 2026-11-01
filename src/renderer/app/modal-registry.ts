import { ArchiveLaneDialog } from '@renderer/features/app-sidebar/archive-lane-dialog';
import { CreateWorkItemDialog } from '@renderer/features/create-work-item/create-work-item-dialog';
import { IntegrationSetupModal } from '@renderer/features/integrations/integration-setup-modal';
import { McpModal } from '@renderer/features/mcp/components/McpModal';
import { CustomCommandModal } from '@renderer/features/settings/components/CustomCommandModal';
import { ShareModal } from '@renderer/features/sharing/share-modal';
import { CreateSkillModal } from '@renderer/features/skills/components/CreateSkillModal';
import { SkillDetailModal } from '@renderer/features/skills/components/SkillDetailModal';
import { CreatePrModal } from '@renderer/features/work-list/create-pr-modal';
import { LinkIssueModal } from '@renderer/features/work-list/link-issue-modal';
import { AdoptWorktreeDialog } from '@renderer/features/worktree-sources/adopt-worktree-dialog';
import { AddSshConnModal } from '@renderer/lib/components/add-ssh-conn-modal';
import { ConfirmActionDialog } from '@renderer/lib/components/confirm-action-dialog';
import { FeedbackModal } from '@renderer/lib/components/feedback-modal/feedback-modal';
import { GithubDeviceFlowModalOverlay } from '@renderer/lib/components/github-device-flow-modal';
import { type ModalComponent } from '@renderer/lib/modal/modal-provider';

export type ModalSize = 'xs' | 'sm' | 'md' | 'lg';

export type ModalRegistryEntry<TProps = unknown, TResult = unknown> = {
  component: ModalComponent<TProps, TResult>;
  size?: ModalSize;
};

export function createModal<TProps, TResult>(
  component: ModalComponent<TProps, TResult>,
  config: Omit<ModalRegistryEntry, 'component'> = {}
): ModalRegistryEntry<TProps, TResult> {
  return { component, ...config };
}

export const modalRegistry = {
  addSshConnModal: createModal(AddSshConnModal),
  githubDeviceFlowModal: createModal(GithubDeviceFlowModalOverlay, { size: 'md' }),
  confirmActionModal: createModal(ConfirmActionDialog, { size: 'xs' }),
  archiveLaneDialog: createModal(ArchiveLaneDialog, { size: 'xs' }),
  feedbackModal: createModal(FeedbackModal),
  mcpServerModal: createModal(McpModal),
  createSkillModal: createModal(CreateSkillModal),
  skillDetailModal: createModal(SkillDetailModal, { size: 'md' }),
  customCommandModal: createModal(CustomCommandModal, { size: 'md' }),
  integrationSetupModal: createModal(IntegrationSetupModal, { size: 'md' }),
  createWorkItemDialog: createModal(CreateWorkItemDialog, { size: 'md' }),
  linkIssueModal: createModal(LinkIssueModal, { size: 'md' }),
  shareModal: createModal(ShareModal, { size: 'md' }),
  createPrModal: createModal(CreatePrModal, { size: 'md' }),
  adoptWorktreeDialog: createModal(AdoptWorktreeDialog, { size: 'md' }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} satisfies Record<string, ModalRegistryEntry<any, any>>;
