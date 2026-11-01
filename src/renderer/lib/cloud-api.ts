import type {
  ArtifactsOnlyWorkItem,
  CloudChatMessage,
  CloudCommand,
  CloudGitFileContent,
  CloudGitStateMeta,
  CloudPermissionRequest,
  CloudPlanRequest,
  CloudSession,
  CloudWorktree,
  CommandStatus,
  NotificationView,
  PermissionRequestStatus,
  PlanRequestStatus,
  WorkItemOwner,
} from '@chord/protocol';
import { cloudFetch } from '@renderer/lib/cloud-fetch';

// Mirror of the server work_items row (server/src/db/schema.ts — workItems),
// with its owner joined in, as served to someone who reaches the work item.
export interface CloudWorkItem extends WorkItemOwner {
  access_scope: 'work_item';
  id: string;
  org_id: string;
  creator_id: string;
  name: string;
  status: string;
  workflow_phase: string | null;
  ticket_id: string | null;
  ticket_provider: string | null;
  ticket_url: string | null;
  pr_number: number | null;
  pr_url: string | null;
  repo_name: string | null;
  /** The repo's normalized origin (`@shared/repo-remote-url`); null until the owner's app sends it. */
  repo_remote_url: string | null;
  branch_name: string | null;
  agent_provider: string | null;
  // Who has access (P6): 'invited' (only the author and members) or 'team'
  // (every member of org_id at general_role). A work item is never public.
  general_access: 'invited' | 'team';
  general_role: 'view' | 'edit';
  // Who may answer agent permission requests via permission_response
  // commands: 'owner' (default) or 'participants' (per-item opt-in).
  approval_policy: string;
  // 'manual' (v1) | 'semi_live' (reserved) — does ambient chat wake the agent.
  delivery_policy: string;
  version_number: number;
  created_at: string;
  updated_at: string;
  /**
   * Whether any device socket is connected for creator_id right now — the
   * "agent host online" signal. Present on the per-id GET only (computed
   * from live socket state, not a column); absent on list endpoints. Kept
   * live via the device_presence_changed room broadcast.
   */
  creator_device_online?: boolean;
  /**
   * Worktree METADATA sub-rows (T0.8, D2) — branch, title, primary flag,
   * status bucket, diff counts, archive state. No file contents. Present on
   * `shared-with-me` and the per-id GET; renders the sidebar's Team
   * sub-rows in Phase 3 (no UI change yet — see use-shared-work-items.ts).
   */
  worktrees?: CloudWorktree[];
  /**
   * The work item's agent CHAT threads (devstation-uka). Present on
   * `shared-with-me` and the per-id GET; this is what lets a participant
   * render one tab per thread and address a message to one of them, instead
   * of the single merged feed they got while `agent_sessions` was local-only.
   * Shell terminals are never published.
   */
  sessions?: CloudSession[];
  /**
   * The REQUESTING user's role, resolved server-side by the one access
   * resolver (server/src/access/resolve-access.ts): 'author' (creator),
   * 'edit' (Can edit) or 'view' (Can view — read and comment only). The UI
   * disables write affordances for 'view' rather than let them fail. Not
   * derivable from the member list: team access grants a role with no member
   * row. Present on the per-id GET only; absent on list endpoints.
   */
  caller_role?: 'author' | 'edit' | 'view';
}

/** A shared-with-me row: a work item, or one reached only through its artifacts. */
export type SharedWithMeRow = CloudWorkItem | ArtifactsOnlyWorkItem;

export interface OnlineUser {
  user_id: string;
  status: string;
  work_item_id: string | null;
  last_seen: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  work_item_name: string | null;
}

/** An active member of one of the caller's own work items (dashboard card avatars). */
export interface ParticipantRosterRow {
  work_item_id: string;
  user_id: string;
  role: 'view' | 'edit';
  email: string;
  name: string | null;
  avatar_url: string | null;
}

export interface WorkItemPresenceRow {
  user_id: string;
  status: string;
  cursor_position: { file?: string; line?: number; column?: number } | null;
  active_view: string | null;
  last_seen: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
}

// Mirror of the server artifacts row (server/src/db/schema.ts — artifacts).
export interface CloudArtifact {
  id: string;
  work_item_id: string;
  name: string;
  content_type: string;
  content: string;
  status: string | null;
  created_at: string;
  updated_at: string;
}

export interface ArtifactVersion {
  id: string;
  artifact_id: string;
  document_name: string;
  version_number: number;
  author_id: string | null;
  author_name: string | null;
  label: string | null;
  byte_size: number;
  trigger: string;
  created_at: string;
}

/** Where a mention was written: a chat message, or an artifact comment in the cloud. */
export type MentionSource = { message_id: string } | { comment_id: string };

export const cloudApi = {
  getSharedWithMe: () =>
    cloudFetch<SharedWithMeRow[]>('/work-items/shared-with-me?include=artifacts'),

  getWorkItem: (workItemId: string) =>
    cloudFetch<CloudWorkItem | ArtifactsOnlyWorkItem>(
      `/work-items/${workItemId}?include=artifacts`
    ),

  getOnlineUsers: () => cloudFetch<OnlineUser[]>('/presence/online-users'),

  /** Every active member of every item the caller created, in one request —
   * the dashboard cards' avatars (GET /work-items/participant-rosters). */
  getParticipantRosters: () =>
    cloudFetch<ParticipantRosterRow[]>('/work-items/participant-rosters'),

  /** `source` is where the mention was written, so a click opens it; none for a comment stored only locally. */
  notifyMentions: (
    workItemId: string,
    userIds: string[],
    excerpt: string,
    source: MentionSource | null
  ) =>
    cloudFetch<{ notified: number }>(`/work-items/${workItemId}/mentions`, {
      method: 'POST',
      body: JSON.stringify({ user_ids: userIds, excerpt, ...source }),
    }),

  getArtifacts: (workItemId: string) =>
    cloudFetch<CloudArtifact[]>(`/work-items/${workItemId}/artifacts`),

  /**
   * Keyset-paged chat history, ascending (created_at, id). Cursors are
   * "<created_at ISO>,<id>" built from a row's own fields. No cursor = the
   * newest page; `before` walks older history; `after` reseeds newer-than.
   */
  getMessages: (
    workItemId: string,
    options?: { limit?: number; before?: string; after?: string }
  ) => {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) params.set('limit', String(options.limit));
    if (options?.before) params.set('before', options.before);
    if (options?.after) params.set('after', options.after);
    const query = params.size > 0 ? `?${params.toString()}` : '';
    return cloudFetch<CloudChatMessage[]>(`/work-items/${workItemId}/messages${query}`);
  },

  /** Full row for a message the list endpoint trimmed (metadata.truncated). */
  getMessage: (workItemId: string, messageId: string) =>
    cloudFetch<CloudChatMessage>(`/work-items/${workItemId}/messages/${messageId}`),

  /**
   * Batch on-demand fetch for rows the list endpoint trimmed — up to 50 ids
   * per call (server-enforced). Ids that don't exist or belong to a
   * different work item are silently omitted from the result, not 404'd.
   */
  hydrateMessages: (workItemId: string, ids: string[]) =>
    cloudFetch<CloudChatMessage[]>(`/work-items/${workItemId}/messages/hydrate`, {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),

  getPresenceForWorkItem: (workItemId: string) =>
    cloudFetch<WorkItemPresenceRow[]>(`/presence/${workItemId}`),

  /**
   * Issues a command for the owner's device to execute (write tier gated
   * server-side). For 'prompt', the server inserts the room-visible chat row
   * atomically with the command — pass chat_message_id to match an
   * optimistic local append. Status transitions arrive as command_updated.
   */
  postCommand: (
    workItemId: string,
    command:
      | {
          kind: 'prompt';
          payload: { content: string; chat_message_id?: string };
          // The thread this was typed into. The server has always stored and
          // validated it (routes/commands.ts); the owner's inbox routes on it
          // since 70a67b8. It was unreachable from here only because a
          // participant had no way to name a thread before the registry.
          session_id?: string | null;
        }
      | { kind: 'interrupt'; payload: Record<string, never>; session_id?: string | null }
      | {
          kind: 'permission_response';
          payload: { request_id: string; option_id: 'allow_once' | 'allow_always' | 'reject_once' };
        }
      | {
          kind: 'plan_response';
          payload: { request_id: string; action: 'approve' | 'reject' };
        }
  ) =>
    cloudFetch<CloudCommand>(`/work-items/${workItemId}/commands`, {
      method: 'POST',
      body: JSON.stringify(command),
    }),

  /** Issuer/room view of command states — seeds the status chips. */
  getCommands: (workItemId: string, status?: CommandStatus) =>
    cloudFetch<CloudCommand[]>(
      `/work-items/${workItemId}/commands${status ? `?status=${status}` : ''}`
    ),

  /**
   * Agent permission requests the owner's device published (design §4) —
   * seeds the participant cards; transitions arrive as
   * permission_request_updated. Answers go through postCommand
   * ('permission_response'), not this surface.
   */
  getPermissionRequests: (workItemId: string, status?: PermissionRequestStatus) =>
    cloudFetch<CloudPermissionRequest[]>(
      `/work-items/${workItemId}/permission-requests${status ? `?status=${status}` : ''}`
    ),

  getPlanRequests: (workItemId: string, status?: PlanRequestStatus) =>
    cloudFetch<CloudPlanRequest[]>(
      `/work-items/${workItemId}/plan-requests${status ? `?status=${status}` : ''}`
    ),

  /** Creator-only: who may answer permission requests ('owner' | 'participants'). */
  updateApprovalPolicy: (workItemId: string, approvalPolicy: 'owner' | 'participants') =>
    cloudFetch<CloudWorkItem>(`/work-items/${workItemId}/approval-policy`, {
      method: 'PATCH',
      body: JSON.stringify({ approval_policy: approvalPolicy }),
    }),

  /** Latest owner-pushed git snapshot metadata. 404 = the owner never synced. */
  getGitState: (workItemId: string) =>
    cloudFetch<CloudGitStateMeta>(`/work-items/${workItemId}/git-state`),

  /** Lazy per-file contents — only files listed with content_omitted=false have a row. */
  getGitStateFile: (workItemId: string, path: string) =>
    cloudFetch<CloudGitFileContent>(
      `/work-items/${workItemId}/git-state/file?path=${encodeURIComponent(path)}`
    ),

  // ── Notifications ──────────────────────────────────────────────────────────

  /** Server-truth notification history (newest 50), incl. authoritative read state. */
  getNotifications: () => cloudFetch<NotificationView[]>('/notifications'),

  /** Persists a single notification as read; server read state is the truth. */
  markNotificationRead: (id: string) =>
    cloudFetch<{ id: string; read: boolean }>(`/notifications/${id}/read`, { method: 'PATCH' }),

  /** Persists all of the caller's unread notifications as read. */
  markAllNotificationsRead: () =>
    cloudFetch<{ status: string }>('/notifications/read-all', { method: 'PATCH' }),
};
