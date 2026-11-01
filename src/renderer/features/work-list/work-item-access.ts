import type { RailPanelId } from '@renderer/features/right-rail/rail-store';
import type { PathMode } from './center-tab';

/**
 * Who is looking at a work item (shared-items design §6). The owner is the
 * account the item belongs to; a member reaches it through sharing, on the
 * whole work item or on some of its artifacts only.
 */
export interface WorkItemAccessInput {
  viewer: 'owner' | 'member';
  /** A member's role. The owner's is ignored: the owner can do everything. */
  role: 'edit' | 'view';
  scope: 'work_item' | 'artifacts';
  /** Who answers the agent's permission and plan requests. */
  approvalPolicy: 'owner' | 'participants';
  /**
   * A member who created the item, reading it on another machine: they have
   * no checkout here, but the item is still theirs to share.
   */
  author?: boolean;
}

/** What the viewer can do: one field per row of design §6's table, then the rest. */
export interface WorkItemCapabilities {
  /** full: send and configure; compose: send to the owner's agent; read: the transcript only. */
  chat: 'full' | 'compose' | 'read' | 'none';
  terminal: boolean;
  changes: boolean;
  files: boolean;
  artifactTabs: 'all' | 'shared';
  /** The modes an artifact tab may offer; `resolvePathModes` drops those it cannot have. */
  documentModes: readonly PathMode[];
  /** The modes a plain repo file may offer: a teammate has only the pushed diff. */
  fileModes: readonly PathMode[];
  comments: { comment: boolean; askAgent: boolean; mentions: boolean };
  versions: { view: boolean; restore: boolean };
  /** manage: the Share dialog; blocked: Share says only the owner shares; hidden: no Share. */
  share: 'manage' | 'blocked' | 'hidden';
  /** The rail's panels this viewer sees, in the manifest's order. */
  railPanels: readonly RailPanelId[];
  /** Answer the agent's permission and plan requests, or see why not. */
  approvals: 'answer' | 'owner_only' | 'none';
  /** Revert the worktree to a turn's checkpoint. */
  checkpoints: boolean;
  stopAgent: boolean;
  deleteArtifact: boolean;
  /** Rename the item, mark it done. */
  editItem: boolean;
  /** The command palette's work-item actions (stop agent, new terminal, git). */
  paletteActions: boolean;
  /** Pick the agent, model, effort and worktree in the composer. */
  configureAgent: boolean;
  /**
   * Address the agent from the composer. A teammate's prompt is a command,
   * which the server takes only with edit and a delegated policy
   * (server/src/routes/commands.ts).
   */
  promptAgent: boolean;
  /**
   * Join the work item's room and read its work_item routes (presence,
   * participants, git state, chat, the artifact summary). The server refuses
   * an artifacts-only viewer every one of them (403 ARTIFACTS_ONLY).
   */
  workItemRoom: boolean;
}

const OWNER_CAPABILITIES: WorkItemCapabilities = {
  chat: 'full',
  terminal: true,
  changes: true,
  files: true,
  artifactTabs: 'all',
  documentModes: ['diff', 'preview', 'edit'],
  fileModes: ['diff', 'preview', 'edit'],
  comments: { comment: true, askAgent: true, mentions: true },
  versions: { view: true, restore: true },
  share: 'manage',
  // Run is the owner's: its processes run on their machine, in their checkout.
  railPanels: ['work-item', 'source-control', 'explorer', 'checks-pr', 'run'],
  approvals: 'answer',
  checkpoints: true,
  stopAgent: true,
  deleteArtifact: true,
  editItem: true,
  paletteActions: true,
  configureAgent: true,
  promptAgent: true,
  workItemRoom: true,
};

const MEMBER_BASE = {
  terminal: false,
  files: false,
  versions: { view: true, restore: false },
  checkpoints: false,
  stopAgent: false,
  deleteArtifact: false,
  editItem: false,
  paletteActions: false,
  configureAgent: false,
} as const;

/**
 * The one decision of what a viewer can do. Every gate in the work item's
 * view reads it rather than testing roles itself.
 */
export function resolveWorkItemCapabilities(input: WorkItemAccessInput): WorkItemCapabilities {
  if (input.viewer === 'owner') {
    if (input.scope !== 'work_item') {
      throw new Error('The owner of a work item always has the whole work item');
    }
    return OWNER_CAPABILITIES;
  }

  if (input.scope === 'artifacts') {
    return {
      ...MEMBER_BASE,
      chat: 'none',
      changes: false,
      artifactTabs: 'shared',
      documentModes: ['preview'],
      fileModes: [],
      // Mentions draw on the work item's people, whom this viewer cannot see.
      comments: { comment: true, askAgent: false, mentions: false },
      share: 'hidden',
      railPanels: ['work-item'],
      approvals: 'none',
      promptAgent: false,
      workItemRoom: false,
    };
  }

  const canEdit = input.role === 'edit';
  const delegated = canEdit && input.approvalPolicy === 'participants';
  return {
    ...MEMBER_BASE,
    chat: canEdit ? 'compose' : 'read',
    changes: true,
    artifactTabs: 'all',
    documentModes: ['diff', 'preview'],
    // The repo is on the owner's machine: a plain file is only its pushed diff.
    fileModes: ['diff'],
    comments: { comment: true, askAgent: true, mentions: true },
    share: input.author ? 'manage' : 'blocked',
    railPanels: ['work-item', 'source-control', 'checks-pr'],
    // Answers are commands, and POST /commands requires edit
    // (server/src/routes/commands.ts:116).
    approvals: delegated ? 'answer' : 'owner_only',
    promptAgent: delegated,
    workItemRoom: true,
  };
}
