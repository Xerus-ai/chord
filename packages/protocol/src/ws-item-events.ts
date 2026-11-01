import { z } from 'zod';
import { CloudSessionSchema } from './sessions.js';
import { CloudWorktreeSchema } from './worktrees.js';

/**
 * Server → client events of git state, sharing, artifacts, comments,
 * commands, the owner's device, agent requests, and the worktree and session
 * registries (split from ws-events.ts, which unions every server event).
 */

// Thin ping only — never snapshot content on the socket: the sidebar holds
// rooms for every shared item, so a full snapshot would fan out ~1MB to idle
// clients with no backpressure. Receivers refetch the metadata GET via
// react-query invalidation. version/captured_at come from the PUT upsert's
// RETURNING values so a ping always pairs with its own accepted payload.
export const GitStateUpdatedServerEventSchema = z.object({
  type: z.literal('git_state_updated'),
  payload: z.object({
    work_item_id: z.string(),
    version: z.number(),
    captured_at: z.string(),
    branch_name: z.string().nullable(),
  }),
});

// Broadcast to the room strictly AFTER a confirmed delete (an unauthorized or
// failed attempt must never emit it). In-room clients react live; everyone
// else converges via REST 404 / sidebar disappearance.
export const WorkItemDeletedServerEventSchema = z.object({
  type: z.literal('work_item_deleted'),
  payload: z.object({
    work_item_id: z.string(),
  }),
});

export const ParticipantAddedServerEventSchema = z.object({
  type: z.literal('participant_added'),
  payload: z.object({
    work_item_id: z.string(),
    user_id: z.string(),
    email: z.string(),
    // Member role (P6 vocabulary): 'view' = Can view, 'edit' = Can edit.
    role: z.enum(['view', 'edit']),
  }),
});

export const ParticipantRemovedServerEventSchema = z.object({
  type: z.literal('participant_removed'),
  payload: z.object({
    work_item_id: z.string(),
    user_id: z.string(),
  }),
});

// An existing participant's tier changed (edit ⇄ view). participant_added is
// the roster-UPSERT doorbell (roster consumers refetch on it and converge the
// same way for an add or a role change); this event names WHAT changed, which
// is what lets a demoted user's composer re-gate live instead of waiting for
// a refetch to land, and carries the tier the row held before the PATCH.
export const ParticipantRoleChangedServerEventSchema = z.object({
  type: z.literal('participant_role_changed'),
  payload: z.object({
    work_item_id: z.string(),
    user_id: z.string(),
    email: z.string(),
    role: z.enum(['view', 'edit']),
    previous_role: z.enum(['view', 'edit']),
  }),
});

// Sharing of one artifact changed (P6): a member was added, re-roled or
// removed (user_id set), or its general access / public link changed
// (user_id null). Thin doorbell to the affected user and the artifact's rooms;
// receivers refetch the artifact's sharing state over REST.
export const ArtifactAccessChangedServerEventSchema = z.object({
  type: z.literal('artifact_access_changed'),
  payload: z.object({
    work_item_id: z.string(),
    artifact_id: z.string(),
    user_id: z.string().nullable(),
  }),
});

// An artifact was registered (created, or renamed) in a work item. A doorbell
// to the work-item room: an open teammate view refetches its artifact list,
// so a page the owner publishes after the teammate opened the item shows up.
export const ArtifactRegisteredServerEventSchema = z.object({
  type: z.literal('artifact_registered'),
  payload: z.object({
    work_item_id: z.string(),
    artifact_id: z.string(),
  }),
});

// An artifact was deleted by its author (P6). Everyone viewing it closes it;
// the file on the author's disk is untouched.
export const ArtifactDeletedServerEventSchema = z.object({
  type: z.literal('artifact_deleted'),
  payload: z.object({
    work_item_id: z.string(),
    artifact_id: z.string(),
  }),
});

// A version of an artifact was saved in the cloud (P6 viewing model): a
// manual save, an agent milestone, or a page snapshot upload. Thin doorbell to
// the work-item and artifact rooms; open viewers refetch the version list and,
// for a page with a view (has_view), reload the snapshot frame in place.
export const ArtifactVersionCreatedServerEventSchema = z.object({
  type: z.literal('artifact_version_created'),
  payload: z.object({
    work_item_id: z.string(),
    artifact_id: z.string(),
    version_id: z.string(),
    version_number: z.number().int(),
    trigger: z.enum(['auto', 'manual', 'agent_milestone']),
    has_view: z.boolean(),
  }),
});

// Thin ping on artifact comment creation — the comment body never rides the
// socket (the git_state_updated convention): receivers refetch the artifact's
// comments over REST, which also keeps the cloud store the single source of
// truth for a cloud artifact's comments rather than letting a wire shape
// become a second one. artifact_id lets a consumer ignore comments on an
// artifact it isn't showing without a round trip.
export const CommentCreatedServerEventSchema = z.object({
  type: z.literal('comment_created'),
  payload: z.object({
    work_item_id: z.string(),
    artifact_id: z.string(),
    comment_id: z.string(),
    author_id: z.string(),
  }),
});

// Thin doorbell to the work item creator's DEVICE sockets on command insert
// (the git_state_updated pattern — never the command payload itself; the
// device fetches over REST). Missed pings don't matter: devices also fetch
// on reconnect and on a 30s interval.
export const CommandsAvailableServerEventSchema = z.object({
  type: z.literal('commands_available'),
  payload: z.object({
    work_item_id: z.string(),
  }),
});

// Command status transitions (claimed / acked / failed / expired) broadcast
// to the work-item room so issuers get live status chips. Insert ('pending')
// is deliberately NOT broadcast: the issuer has the POST response, and a
// prompt's room-visible chat row carries metadata.command_id.
export const CommandUpdatedServerEventSchema = z.object({
  type: z.literal('command_updated'),
  payload: z.object({
    id: z.string(),
    work_item_id: z.string(),
    kind: z.string(),
    issuer_id: z.string(),
    status: z.string(),
    status_reason: z.string().nullable(),
  }),
});

// Whether any DEVICE socket is connected for a user — the honest "agent host
// online" signal (no session registry). Broadcast into every room of a work
// item the user created (room-scoped, not org-scoped: participants are
// routinely cross-org via share-by-email); clients map a work item's
// creator_id to this. The same boolean rides GET /work-items/:id as
// creator_device_online.
export const DevicePresenceChangedServerEventSchema = z.object({
  type: z.literal('device_presence_changed'),
  payload: z.object({
    user_id: z.string(),
    // The room this copy was broadcast into — top-level so the renderer's
    // room-scoped dispatch reaches item-scoped subscribers.
    work_item_id: z.string(),
    online: z.boolean(),
  }),
});

// Room broadcast on agent_permission_requests transitions so participant
// views render cards live and disable Allow/Deny the moment a request
// resolves — no stale-button window. Producers: the expiry sweep now
// (routes/commands-device.ts), the publication/resolution taps in Slice 5.
export const PermissionRequestUpdatedServerEventSchema = z.object({
  type: z.literal('permission_request_updated'),
  payload: z.object({
    request_id: z.string(),
    work_item_id: z.string(),
    status: z.string(),
    resolved_by: z.string().nullable(),
    resolution: z.string().nullable(),
  }),
});

// Room broadcast on agent_plan_requests transitions so participant views
// render plan cards live and disable Approve/Reject the moment a request
// resolves — the plan mirror of permission_request_updated.
export const PlanRequestUpdatedServerEventSchema = z.object({
  type: z.literal('plan_request_updated'),
  payload: z.object({
    request_id: z.string(),
    work_item_id: z.string(),
    status: z.string(),
    resolved_by: z.string().nullable(),
    resolution: z.string().nullable(),
  }),
});

// Thin snapshot broadcast (small payload, unlike git-state's ping-only
// shape — a work item's whole worktree list is a handful of rows, not
// megabytes of diff content) on every accepted PUT /work-items/:id/worktrees.
// A new event rather than folding into work_item_updated so old clients that
// don't know about worktrees simply ignore it.
export const WorkItemWorktreesUpdatedServerEventSchema = z.object({
  type: z.literal('work_item_worktrees_updated'),
  payload: z.object({
    work_item_id: z.string(),
    worktrees: z.array(CloudWorktreeSchema),
  }),
});

export const WorkItemSessionsUpdatedServerEventSchema = z.object({
  type: z.literal('work_item_sessions_updated'),
  payload: z.object({
    work_item_id: z.string(),
    sessions: z.array(CloudSessionSchema),
  }),
});

export const ErrorServerEventSchema = z.object({
  type: z.literal('error'),
  payload: z.string(),
});
